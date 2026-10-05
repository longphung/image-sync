<script lang="ts">
  import { onMount } from 'svelte';
  import { denyPairRequest, getCard, getLibrary, getStatus, type MediaItem, type Status } from './api';
  import CardGrid from './CardGrid.svelte';
  import Library from './Library.svelte';
  import Settings from './Settings.svelte';

  let status = $state<Status | null>(null);
  let items = $state.raw<MediaItem[]>([]);
  let library = $state.raw<MediaItem[]>([]);
  let tab = $state<'camera' | 'library' | 'settings'>('camera');

  async function loadCard() {
    items = status?.camera ? await getCard().catch(() => []) : [];
  }

  async function loadLibrary() {
    library = await getLibrary().catch(() => []);
  }

  // Reloaded each time the tab is opened, since files can change in the folder outside the app.
  $effect(() => {
    if (tab === 'library') loadLibrary();
  });

  function reload() {
    loadCard();
    loadLibrary();
  }

  onMount(() => {
    const poll = async () => {
      const prev = status;
      status = await getStatus();
      // Reload the card when it's plugged in or removed, and both lists after an import.
      if (status.camera !== prev?.camera) loadCard();
      if (prev?.import.running && !status.import.running) reload();
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => clearInterval(timer);
  });

  const progress = $derived.by(() => {
    if (!status) return '';
    const { running, volume, counts: c } = status.import;
    if (volume) {
      const converts = c.converted || c.convert_failed ? `, ${c.converted} videos converted to MP4, ${c.convert_failed} failed` : '';
      const converting = c.converting ? ` Converting ${c.converting} to MP4 (${c.percent}%); the camera can be unplugged.` : '';
      return `${running ? 'Importing' : 'Imported'} from ${volume}: ${c.copied + c.skipped + c.failed}/${c.total}`
        + ` (${c.copied} copied, ${c.skipped} already in library, ${c.failed} failed${converts}).${converting}`;
    }
    return status.camera
      ? `Camera at ${status.camera}. Pick photos and videos, then Sync selected.`
      : 'Plug in the camera with USB Connection set to Mass Storage.';
  });
</script>

<div class="app">
  <header>
    <nav>
      <button class:active={tab === 'camera'} onclick={() => (tab = 'camera')}>Camera</button>
      <button class:active={tab === 'library'} onclick={() => (tab = 'library')}>Library</button>
      <button class:active={tab === 'settings'} onclick={() => (tab = 'settings')}>Phone & settings</button>
    </nav>
    <p class="muted">{progress}</p>
    {#if status?.import.error}<p class="error">{status.import.error}</p>{/if}
  </header>

  {#if tab === 'camera'}
    <CardGrid {items} importing={status?.import.running ?? false} />
  {:else if tab === 'library'}
    <Library items={library} folder={status?.settings.library ?? ''} />
  {:else if status}
    <Settings {status} onsaved={reload} />
  {/if}
</div>

{#if status?.pair_request}
  {@const req = status.pair_request}
  <div class="overlay">
    <div class="dialog" role="alertdialog" aria-labelledby="pair-title">
      <h2 id="pair-title"><strong>{req.name}</strong> wants to pair</h2>
      <p class="muted">Type this code on the phone.</p>
      <p class="code">{req.code.slice(0, 3)} {req.code.slice(3)}</p>
      <p class="muted">Expires in {Math.floor(req.expires_in / 60)}:{String(req.expires_in % 60).padStart(2, '0')}</p>
      <button onclick={denyPairRequest}>Deny</button>
    </div>
  </div>
{/if}

<style>
  .app { height: 100%; display: flex; flex-direction: column; }
  header { padding: 12px 16px 0; }
  header p { margin: 8px 0; }
  nav { display: flex; gap: 4px; }
  nav button { border: none; background: none; color: inherit; border-radius: 6px; opacity: .7; }
  nav button.active { background: color-mix(in srgb, CanvasText 12%, Canvas); opacity: 1; }
  .overlay { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / .4); }
  .dialog { background: Canvas; color: CanvasText; border-radius: 12px; padding: 24px 32px; text-align: center; min-width: 280px; }
  .dialog h2 { font-size: 17px; font-weight: normal; margin: 0 0 4px; }
  .code { font: 600 44px ui-monospace, monospace; letter-spacing: .08em; margin: 16px 0; user-select: all; }
</style>
