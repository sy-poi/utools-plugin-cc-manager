import { ref } from 'vue'

const snackbar = ref({ show: false, message: '', type: 'success' })
let snackbarTimer = null

export function useSnackbar() {
  function showSnackbar(message, type = 'success') {
    clearTimeout(snackbarTimer)
    snackbar.value = { show: true, message, type }
    snackbarTimer = setTimeout(() => { snackbar.value.show = false }, 2500)
  }

  return { snackbar, showSnackbar }
}
