import './lib/polyfills' // first: older TV browsers
import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { initTv } from './lib/tv'

initTv() // TV mode: layout for the sofa, arrow keys move between buttons

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
