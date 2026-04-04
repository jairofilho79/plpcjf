<script>
  import { createEventDispatcher } from 'svelte';
  import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-svelte';

  export let toastId;
  export let variant = 'info';
  export let message = '';
  export let durationMs = 4000;
  const dispatch = createEventDispatcher();

  const RADIUS = 14;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  function dismiss() {
    dispatch('dismiss', { id: toastId });
  }

  $: IconComponent =
    variant === 'success'
      ? CheckCircle2
      : variant === 'error'
        ? AlertCircle
        : variant === 'warning'
          ? AlertTriangle
          : Info;
</script>

<div class="app-snackbar app-snackbar--{variant}" role="status" aria-live="polite">
  <div class="app-snackbar__icon-wrap" aria-hidden="true">
    <svelte:component this={IconComponent} class="app-snackbar__icon" />
  </div>

  <p class="app-snackbar__message">{message}</p>

  <button
    type="button"
    class="app-snackbar__close"
    on:click={dismiss}
    aria-label="Fechar notificação"
  >
    <svg class="app-snackbar__ring" viewBox="0 0 40 40" aria-hidden="true">
      <circle class="app-snackbar__ring-bg" cx="20" cy="20" r={RADIUS} />
      <circle
        class="app-snackbar__ring-progress"
        cx="20"
        cy="20"
        r={RADIUS}
        style={`--ring-duration:${durationMs}ms; --ring-circumference:${RING_CIRCUMFERENCE};`}
      />
    </svg>
    <X class="app-snackbar__close-icon" aria-hidden="true" />
  </button>
</div>

<style>
  .app-snackbar {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: min(24rem, calc(100vw - 2rem));
    max-width: min(30rem, calc(100vw - 2rem));
    padding: 0.65rem 0.65rem 0.65rem 0.8rem;
    border-radius: 0.6rem;
    border: 2px solid transparent;
    box-shadow: var(--shadow-lg);
    background: var(--card-bg);
    color: var(--text-dark);
  }

  .app-snackbar--info {
    border-color: #4f83cc;
  }

  .app-snackbar--success {
    border-color: #3c9a5f;
  }

  .app-snackbar--warning {
    border-color: #d5a324;
  }

  .app-snackbar--error {
    border-color: #d06767;
  }

  .app-snackbar__icon-wrap {
    width: 1.6rem;
    height: 1.6rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .app-snackbar__icon {
    width: 1.2rem;
    height: 1.2rem;
  }

  .app-snackbar--info .app-snackbar__icon {
    color: #2f6fb4;
  }

  .app-snackbar--success .app-snackbar__icon {
    color: #2f8f55;
  }

  .app-snackbar--warning .app-snackbar__icon {
    color: #b98712;
  }

  .app-snackbar--error .app-snackbar__icon {
    color: #c34747;
  }

  .app-snackbar__message {
    margin: 0;
    flex: 1;
    font-size: 0.875rem;
    line-height: 1.35;
    font-weight: 600;
  }

  .app-snackbar__close {
    position: relative;
    width: 2.2rem;
    height: 2.2rem;
    flex-shrink: 0;
    border: none;
    border-radius: 9999px;
    cursor: pointer;
    background: var(--btn-background-color);
    color: var(--text-light);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, filter 0.15s ease;
  }

  .app-snackbar__close:hover {
    filter: brightness(1.1);
  }

  .app-snackbar__close:active {
    transform: scale(0.96);
  }

  .app-snackbar__close-icon {
    position: relative;
    z-index: 2;
    width: 1rem;
    height: 1rem;
  }

  .app-snackbar__ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
    pointer-events: none;
  }

  .app-snackbar__ring-bg {
    fill: none;
    stroke: rgba(255, 255, 255, 0.25);
    stroke-width: 2.5;
  }

  .app-snackbar__ring-progress {
    fill: none;
    stroke: var(--gold-light);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: var(--ring-circumference);
    stroke-dashoffset: 0;
    animation: app-snackbar-ring var(--ring-duration) linear forwards;
  }

  @keyframes app-snackbar-ring {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: var(--ring-circumference);
    }
  }
</style>
