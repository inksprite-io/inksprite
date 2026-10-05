import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'
import StyleClass from 'primevue/styleclass'
import Tooltip from 'primevue/tooltip'
import ToastService from 'primevue/toastservice'
import App from './App.vue'
import router from './router'

const app = createApp(App)
const pinia = createPinia()

const auraindigoPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{indigo.50}',
      100: '{indigo.100}',
      200: '{indigo.200}',
      300: '{indigo.300}',
      400: '{indigo.400}',
      500: '{indigo.500}',
      600: '{indigo.600}',
      700: '{indigo.700}',
      800: '{indigo.800}',
      900: '{indigo.900}',
      950: '{indigo.950}',
    },
    colorScheme: {
      dark: {
        surface: {
          0: '#ffffff',
          50: '{zinc.50}',
          100: '{zinc.100}',
          200: '{zinc.200}',
          300: '{zinc.300}',
          400: '{zinc.400}',
          500: '{zinc.500}',
          600: '{zinc.600}',
          700: '{zinc.700}',
          800: '{zinc.800}',
          900: '{zinc.900}',
          950: '{zinc.950}',
        },
      },
      light: {
        surface: {
          0: '#ffffff',
          50: '{slate.50}',
          100: '{slate.100}',
          200: '{slate.200}',
          300: '{slate.300}',
          400: '{slate.400}',
          500: '{slate.500}',
          600: '{slate.600}',
          700: '{slate.700}',
          800: '{slate.800}',
          900: '{slate.900}',
          950: '{slate.950}',
        },
      },
    },
  },
  components: {
    // Aura tints the handle the same surface a panel is likely painted with,
    // which leaves it invisible against, say, a chat in dark mode. Pull it
    // clear of the backgrounds these panels actually sit on.
    scrollpanel: {
      colorScheme: {
        light: { bar: { background: '{surface.300}' } },
        dark: { bar: { background: '{surface.600}' } },
      },
    },
  },
})

app.use(pinia)
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: auraindigoPreset,
    options: {
      darkModeSelector: '.inksprite-dark',
    },
  },
})
app.use(ConfirmationService)
app.use(ToastService)

app.directive('styleclass', StyleClass)
app.directive('tooltip', Tooltip)

app.mount('#app')
