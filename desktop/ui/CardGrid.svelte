<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { mb, sync, type MediaItem } from './api';
  import MediaGrid from './MediaGrid.svelte';

  let { items, importing }: { items: MediaItem[]; importing: boolean } = $props();

  // Per-key reactivity: toggling one item only re-renders that tile.
  const selected = new SvelteSet<string>();
  let error = $state('');

  const photos = $derived(items.filter((i) => !i.video).length);
  const selectedSize = $derived(items.reduce((sum, i) => (selected.has(i.path) ? sum + i.size : sum), 0));

  // Drop selections for items no longer on the card.
  $effect(() => {
    const paths = new Set(items.map((i) => i.path));
    for (const path of selected) if (!paths.has(path)) selected.delete(path);
  });

  function select(filter: (item: MediaItem) => boolean) {
    selected.clear();
    for (const item of items) if (filter(item)) selected.add(item.path);
  }

  async function syncSelected() {
    error = '';
    try {
      await sync([...selected]);
      selected.clear();
    } catch (err) {
      error = String(err);
    }
  }
</script>

{#if items.length}
  <div class="toolbar">
    <span class="muted grow">
      {photos} photos, {items.length - photos} videos · {selected.size} selected ({mb(selectedSize)})
    </span>
    <button onclick={() => select(() => true)}>Select all</button>
    <button onclick={() => select((i) => !i.imported)}>Select not in library</button>
    <button onclick={() => selected.clear()}>Select none</button>
    <button class="primary" disabled={importing || selected.size === 0} onclick={syncSelected}>
      Sync selected ({selected.size})
    </button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  <MediaGrid {items} {selected} />
{/if}

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 16px 8px; }
  .grow { flex: 1; }
  .primary { font-weight: 600; }
  .error { margin: 0 16px 8px; }
</style>
