import { mount } from 'svelte';
import '../app.css';
import Scan from './Scan.svelte';

export default mount(Scan, { target: document.getElementById('app')! });
