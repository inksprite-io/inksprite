// Type declarations for PrimeVue modules
// These are ambient module declarations to satisfy TypeScript's module resolution

declare module 'primevue/config' {
  const PrimeVue: any
  export default PrimeVue
}

declare module 'primevue/confirmationservice' {
  const ConfirmationService: any
  export default ConfirmationService
}

declare module 'primevue/styleclass' {
  const StyleClass: any
  export default StyleClass
}

declare module 'primevue/tooltip' {
  const Tooltip: any
  export default Tooltip
}

declare module 'primevue/toastservice' {
  const ToastService: any
  export default ToastService
}

declare module 'primevue/usetoast' {
  export function useToast(): any
}
