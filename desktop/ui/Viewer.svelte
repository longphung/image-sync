<script lang="ts">
  import { fileUrl, mb, thumbUrl, type MediaItem } from './api';

  let { items, index = $bindable() }: { items: MediaItem[]; index: number | null } = $props();

  const item = $derived(items[index!]);
  const avchd = $derived(/\.mts$/i.test(item.name));
  let loaded = $state(false);
  let videoError = $state('');

  // Reset per item: the cached thumbnail shows at once, the full-size file fades in over it.
  $effect(() => {
    item;
    loaded = false;
    videoError = '';
  });

  const close = () => (index = null);
  const step = (by: number) => (index = Math.min(items.length - 1, Math.max(0, index! + by)));

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  }

  const MEDIA_ERRORS = ['', 'aborted', 'network error', 'decode error', 'format not supported'];
  function onVideoError(e: Event) {
    const err = (e.currentTarget as HTMLVideoElement).error;
    videoError = `Can't play this video here (${MEDIA_ERRORS[err?.code ?? 0] || 'unknown error'}${err?.message ? `: ${err.message}` : ''}). It can still be synced.`;
  }
</script>

<svelte:window onkeydown={keydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="viewer" onclick={close}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="stage" onclick={(e) => e.stopPropagation()}>
    {#key item.path}
      {#if item.video && !avchd}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={fileUrl(item)} poster={thumbUrl(item)} controls autoplay onerror={onVideoError}></video>
      {:else}
        <img class="placeholder" src={thumbUrl(item)} alt="" />
        {#if !item.video}
          <img class="full" class:loaded src={fileUrl(item)} alt={item.name} onload={() => (loaded = true)} />
        {/if}
      {/if}
    {/key}
  </div>
  <div class="caption">
    {item.name} · {mb(item.size)} · {index! + 1}/{items.length}
    {#if avchd}<br />AVCHD (.MTS) can't play here, but it can still be synced.{/if}
    {#if videoError}<br /><span class="error">{videoError}</span>{/if}
  </div>
  <div class="muted">← → to browse · Esc or click outside to close</div>
</div>

<style>
  .viewer {
    position: fixed; inset: 0; z-index: 10; background: rgba(0, 0, 0, .9); color: #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  }
  .stage { position: relative; width: 94vw; height: 82vh; }
  .stage > * { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
  .placeholder { filter: blur(6px); }
  .full { opacity: 0; transition: opacity .2s; }
  .full.loaded { opacity: 1; }
  .caption { text-align: center; }
  .error { color: #f77; }
</style>
