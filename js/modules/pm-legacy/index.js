/**
 * PM DLBooks (legacy) module — wraps the existing pm.js feature pending
 * the Phase 8 migration into the new Projects module.
 */

import { state } from '../../state.js';
import { renderPMTab, setupPMEditing } from './pm.js';

const TEMPLATE = `
<section id="pm-dlbooks" class="tab-content active">
    <div id="pm-content" class="budget-container"></div>
</section>
`;

let mounted = false;

export function mount(host) {
    if (mounted) return;
    host.innerHTML = TEMPLATE;
    mounted = true;

    setupPMEditing();
    renderPMTab(state.pmData);
}
