"""Request-local token-prefix reuse for the pinned Qwen hybrid inference stack.

Full attention KV and linear-attention conv/recurrent states are all mutable.
Saved prefix caches remain immutable; each continuation gets its own tensors.
This saves prefix computation, not the memory copies required by HF branching.
"""
from collections import defaultdict
import copy

import torch
from transformers.cache_utils import DynamicCache, DynamicLayer, LinearAttentionLayer

from .api import candidate_prompts


class RecurrentDtypeLayer(LinearAttentionLayer):
    """Retain the recurrent kernel's dtype independently of convolution dtype.

    Transformers 5.10.2 allocates recurrent state with the convolution dtype.
    On BF16 models this rounds the FP32 delta-rule state at every prefix split;
    an unsplit forward keeps that state in FP32. Preserve the returned dtype.
    """

    def lazy_initialization(self, conv_states=None, recurrent_states=None):
        if conv_states is not None:
            super().lazy_initialization(conv_states=conv_states)
        if recurrent_states is not None:
            self.recurrent_states = torch.zeros_like(recurrent_states)
            self.is_recurrent_states_initialized = True


def new_cache(config):
    cache = DynamicCache(config=config)
    cache.layers = [RecurrentDtypeLayer(config) if type(layer) is LinearAttentionLayer else layer
                    for layer in cache.layers]
    return cache


def common_prefix_length(sequences):
    """Find an exact token LCP, leaving at least one final token to score."""
    if not sequences or any(not sequence for sequence in sequences):
        raise ValueError("Prefix scoring requires nonempty token sequences")
    first = sequences[0]
    limit = min(map(len, sequences)) - 1
    for index in range(limit):
        if any(sequence[index] != first[index] for sequence in sequences[1:]):
            return index
    return limit


def fork_cache(cache, batch_size):
    """Copy a one-sequence Qwen cache into independent candidate branches.

    DynamicCache.batch_repeat_interleave is insufficient in transformers 5.10.2:
    LinearAttentionLayer does not implement it. Shallow or KV-only copies also
    alias the in-place recurrent/conv updates and contaminate later candidates.
    """
    if type(batch_size) is not int or batch_size < 1:
        raise ValueError("Cache branch batch size must be a positive integer")
    if type(cache) is not DynamicCache or cache.offloading:
        raise TypeError("Prefix reuse supports non-offloaded DynamicCache only")
    branch = copy.copy(cache)
    branch.layers = []
    for layer in cache.layers:
        if type(layer) is DynamicLayer:
            fields = ("keys", "values")
        elif type(layer) in (LinearAttentionLayer, RecurrentDtypeLayer):
            fields = ("conv_states", "recurrent_states")
        else:
            raise TypeError(f"Unsupported prefix cache layer: {type(layer).__name__}")
        cloned = copy.copy(layer)
        for name in fields:
            tensor = getattr(layer, name)
            if tensor is None:
                continue
            if tensor.shape[0] != 1:
                raise ValueError("Saved prefix cache must have exactly one sequence")
            # repeat_interleave allocates independent storage even for batch=1.
            setattr(cloned, name, tensor.repeat_interleave(batch_size, dim=0))
        if hasattr(cloned, "max_batch_size"):
            cloned.max_batch_size = batch_size
        branch.layers.append(cloned)
    return branch


@torch.inference_mode()
def score_cached(model, records, *, batch_size=32):
    """Return original-order logits and logical/processed input token counts.

    Two levels reuse the common request context and each question's longer
    candidate prefix. All LCPs come from complete chat-template tokenization,
    never separately tokenized strings. Each suffix batch has equal lengths:
    cached Qwen linear attention ignores padding masks, so no padded states are
    introduced. Cache lifetime spans the entire request, including large Choices.
    """
    if model.training or model.backbone.training:
        raise RuntimeError("Prefix caching requires evaluation mode")
    if type(batch_size) is not int or batch_size < 1:
        raise ValueError("Candidate batch size must be a positive integer")
    core = model.backbone.get_base_model() if hasattr(model.backbone, "get_base_model") else model.backbone
    if core.config.model_type != "qwen3_5_text":
        raise ValueError("Prefix caching currently supports Qwen3.5/3.8 text backbones only")
    if not records:
        raise ValueError("Prefix scoring requires at least one record")

    prompts, counts = [], []
    for record in records:
        entries = candidate_prompts(record)
        counts.append(len(entries))
        for prompt in entries:
            prompts.append(model.tokenizer.apply_chat_template(
                [{"role": "user", "content": prompt}], tokenize=False,
                add_generation_prompt=True, enable_thinking=False,
            ))
    encoded = model.tokenizer(prompts, padding=False, truncation=False)
    sequences = encoded["input_ids"]
    if any(not sequence for sequence in sequences):
        raise ValueError("Tokenizer returned an empty candidate")
    lengths = [len(sequence) for sequence in sequences]
    if max(lengths) > model.max_length:
        raise ValueError(f"Input length {max(lengths)} exceeds max_length={model.max_length}; no silent truncation")
    if "attention_mask" in encoded and any(not all(mask) for mask in encoded["attention_mask"]):
        raise ValueError("Unpadded prefix tokenization must contain only attended tokens")
    stats = {"enabled": True, "mode": "request_local_token_prefix", "logical_input_tokens": sum(lengths),
             "processed_input_tokens": 0, "reused_input_tokens": 0, "shared_prefix_tokens": 0,
             "question_prefix_tokens": 0, "prefill_calls": 0, "suffix_batches": 0,
             "suffix_tokens": 0, "max_suffix_batch": 0, "candidate_sequences": len(sequences),
             "recurrent_state_dtype": "preserve_kernel_output"}

    def forward(tokens, cache, position):
        inputs = torch.tensor(tokens, dtype=torch.long, device=model.device_name)
        size, length = inputs.shape
        mask = torch.ones((size, position + length), dtype=torch.long, device=inputs.device)
        positions = torch.arange(position, position + length, device=inputs.device).unsqueeze(0).expand(size, -1)
        # Execute the original wrapper so enabled LoRA adapters remain active.
        result = model.backbone(input_ids=inputs, attention_mask=mask, position_ids=positions,
                                past_key_values=cache if cache is not None else new_cache(core.config),
                                use_cache=True, return_dict=True)
        stats["processed_input_tokens"] += size * length
        return result

    shared_length = common_prefix_length(sequences)
    stats["shared_prefix_tokens"] = shared_length
    shared_cache = None
    if shared_length:
        result = forward([sequences[0][:shared_length]], None, 0)
        shared_cache = result.past_key_values
        stats["prefill_calls"] += 1
        del result

    logits, offset = [], 0
    for record, count in zip(records, counts):
        candidates = sequences[offset:offset + count]
        # A single candidate does not benefit from an extra question prefill.
        prefix_length = common_prefix_length(candidates) if count > 1 else shared_length
        question_cache = shared_cache
        if prefix_length > shared_length:
            initial = fork_cache(shared_cache, 1) if shared_cache is not None else None
            result = forward([candidates[0][shared_length:prefix_length]], initial, shared_length)
            question_cache = result.past_key_values
            stats["question_prefix_tokens"] += prefix_length - shared_length
            stats["prefill_calls"] += 1
            del result, initial

        buckets = defaultdict(list)
        for index, candidate in enumerate(candidates):
            buckets[len(candidate) - prefix_length].append(index)
        scores = [None] * count
        for suffix_length, indices in buckets.items():
            for start in range(0, len(indices), batch_size):
                selected = indices[start:start + batch_size]
                cache = fork_cache(question_cache, len(selected)) if question_cache is not None else None
                result = forward([candidates[index][prefix_length:] for index in selected], cache, prefix_length)
                values = model.head(result.last_hidden_state[:, -1].float()).squeeze(-1)
                for index, value in zip(selected, values.unbind()):
                    scores[index] = value
                stats["suffix_batches"] += 1
                stats["suffix_tokens"] += len(selected) * suffix_length
                stats["max_suffix_batch"] = max(stats["max_suffix_batch"], len(selected))
                del result, cache, values
        values = torch.stack(scores)
        if record["kind"] == "noul":
            values = torch.stack([torch.zeros_like(values[0]), values[0]])
        logits.append(values)
        offset += count
        del question_cache
    stats["reused_input_tokens"] = stats["logical_input_tokens"] - stats["processed_input_tokens"]
    model.last_input_tokens = stats["logical_input_tokens"]
    return logits, stats
