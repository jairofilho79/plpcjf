<script lang="ts">
  import { page } from '$app/stores';
  import LeitorContent from './LeitorContent.svelte';

  /** Opção 2: remonta só o subtree do leitor (novo onMount / refs / PDF) sem reload da SPA. */
  let layoutRemountKey = 0;

  $: searchParams = new URLSearchParams($page.url.search);
  $: file = searchParams.get('file') ?? '/pdfs/exemplo.pdf';
  $: titulo = searchParams.get('titulo') ?? '';
  $: subtitulo = searchParams.get('subtitulo') ?? '';
  $: skipValidation = searchParams.get('validated') === 'true';

  function bumpLayoutRemountKey() {
    layoutRemountKey += 1;
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="/pdfjs/web/pdf_viewer.css" />
</svelte:head>

{#key layoutRemountKey}
  <LeitorContent {file} {titulo} {subtitulo} {skipValidation} on:remountLayout={bumpLayoutRemountKey} />
{/key}
