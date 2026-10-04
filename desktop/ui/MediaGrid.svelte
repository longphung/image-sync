<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity';
  import { VList } from 'virtua/svelte';
  import { mb, thumbUrl, type MediaItem } from './api';
  import Viewer from './Viewer.svelte';

  /**
   * Virtualized thumbnail grid with a full-size viewer. With `selected`, clicking a tile toggles it
   * (shift-click selects a range) and double-click previews; without it, clicking previews.
   */
  let { items, selected }: { items: MediaItem[]; selected?: SvelteSet<string> } = $props();

  const MIN_TILE = 140;
  const GAP = 6;

  let width = $state(0);
  let lastClicked = -1;
  let viewing = $state<number | null>(null);

  const cols = $derived(Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP))));
  const tile = $derived(width ? (width - GAP * (cols - 1)) / cols : MIN_TILE);
  // Virtualized by row: only rows on screen (plus the buffer) exist in the DOM.
  const rows = $derived(
    Array.from({ length: Math.ceil(items.length / cols) }, (_, r) => items.slice(r * cols, (r + 1) * cols)),
  );
  const index = $derived(new Map(items.map((item, i) => [item.path, i])));

  function click(e: MouseEvent, item: MediaItem) {
    const i = index.get(item.path)!;
    if (!selected) {
      viewing = i;
    } else if (e.shiftKey && lastClicked >= 0) {
      // Shift-click selects the range, like Finder / Photos.
      const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
      for (const it of items.slice(a, b + 1)) selected.add(it.path);
    } else if (selected.has(item.path)) {
      selected.delete(item.path);
    } else {
      selected.add(item.path);
    }
    lastClicked = i;
  }
</script>

<div class="grid" bind:clientWidth={width}>
  <VList data={rows} getKey={(row) => row[0].path} itemSize={tile + GAP} bufferSize={tile * 6} style="height: 100%">
    {#snippet children(row)}
      <div class="row" style:grid-template-columns="repeat({cols}, 1fr)" style:height="{tile}px">
        {#each row as item (item.path)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="tile"
            class:sel={selected?.has(item.path)}
            class:imported={selected && item.imported}
            title="{item.name} · {mb(item.size)}"
            role="button"
            tabindex="-1"
            onclick={(e) => click(e, item)}
            ondblclick={() => (viewing = index.get(item.path)!)}
          >
            <img
              src={thumbUrl(item)}
              alt=""
              decoding="async"
              draggable="false"
              onload={(e) => e.currentTarget.classList.add('loaded')}
            />
            {#if selected}<input type="checkbox" checked={selected.has(item.path)} tabindex="-1" />{/if}
            <div class="badges">
              {#if item.video}<span>▶ Video</span>{/if}
              {#if selected && item.imported}<span>In library</span>{/if}
            </div>
            {#if selected}
              <button
                class="zoom"
                title="Preview"
                onclick={(e) => {
                  e.stopPropagation();
                  viewing = index.get(item.path)!;
                }}>⤢</button
              >
            {/if}
            <div class="name">{item.name}</div>
          </div>
        {/each}
      </div>
    {/snippet}
  </VList>
</div>

{#if viewing !== null}
  <Viewer {items} bind:index={viewing} />
{/if}

<style>
  .grid { flex: 1; min-height: 0; margin: 0 16px 16px; }
  .row { display: grid; gap: 6px; padding-bottom: 6px; }
  .tile {
    position: relative; overflow: hidden; border-radius: 6px; cursor: pointer; outline-offset: -3px;
    background: color-mix(in srgb, CanvasText 10%, Canvas);
  }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity .15s; }
  .tile img:global(.loaded) { opacity: 1; }
  .tile.imported img:global(.loaded) { opacity: .55; }
  .tile.sel { outline: 3px solid AccentColor; }
  .tile input { position: absolute; top: 6px; left: 6px; width: 18px; height: 18px; margin: 0; pointer-events: none; }
  .badges { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  .badges span { font-size: 10px; padding: 2px 5px; border-radius: 4px; background: rgba(0, 0, 0, .6); color: #fff; }
  .zoom { position: absolute; right: 6px; bottom: 22px; padding: 2px 7px; font-size: 13px; }
  .name {
    position: absolute; inset: auto 0 0 0; padding: 14px 6px 4px; font-size: 11px; color: #fff;
    background: linear-gradient(transparent, rgba(0, 0, 0, .65));
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
</style>
