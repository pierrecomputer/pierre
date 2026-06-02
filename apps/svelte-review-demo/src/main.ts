import { mount } from 'svelte';

import App from './App.svelte';
import './style.css';

mount(App, {
  target: document.querySelector('#app') as HTMLElement,
});
