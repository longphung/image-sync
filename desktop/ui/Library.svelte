<script lang="ts">
  import { mb, openLibrary, type MediaItem } from './api';
  import MediaGrid from './MediaGrid.svelte';

  let { items, folder }: { items: MediaItem[]; folder: string } = $props();

  let error = $state('');
  const photos = $derived(items.filter((i) => !i.video).length);
  const size = $derived(items.reduce((sum, i) => sum + i.size, 0));

  const open = () => openLibrary().catch((err) => (error = String(err)));
</script>

<div class="toolbar">
  <span class="muted grow">
    {folder} · {photos} photos, {items.length - photos} videos ({mb(size)})
  </span>
  <button onclick={open}>Open folder</button>
</div>
{#if error}<p class="error">{error}</p>{/if}

{#if items.length}
  <MediaGrid {items} />
{:else}
  <p class="muted empty">Nothing synced yet. Pick photos and videos on the Camera tab, then Sync selected.</p>
{/if}

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 16px 8px; }
  .grow { flex: 1; overflow-wrap: anywhere; }
  .error, .empty { margin: 0 16px 8px; }
</style>
