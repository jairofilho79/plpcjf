<script>
  import { Toaster } from 'svelte-sonner';
</script>

<Toaster
  position="bottom-center"
  richColors={false}
  expand={false}
  closeButton={false}
  duration={4000}
  visibleToasts={3}
  offset={{ bottom: 20 }}
  mobileOffset={{ bottom: 14, left: 10, right: 10 }}
  toastOptions={{
    unstyled: true
  }}
/>
