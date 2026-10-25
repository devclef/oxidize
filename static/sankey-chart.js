/**
 * Shared Sankey flow chart (d3 + d3-sankey from the CDN), drawn the same way
 * by dashboard sankey widgets and the Widget Builder preview.
 *
 *  - OxiSankey.available()              d3 and d3-sankey loaded?
 *  - OxiSankey.unavailableMessage       what to tell the user when not
 *  - OxiSankey.render(el, data, opts)   draw /api/sankey/flows data into el
 *                                       (opts.tooltip: element for hovers)
 */
(function () {
    'use strict';

    const UNAVAILABLE_MESSAGE = 'The Sankey chart library (d3) could not be loaded. ' +
        'Check your network connection or content blocker, then refresh the page.';

    function available() {
        return typeof d3 !== 'undefined' && typeof d3.sankey === 'function' &&
            typeof d3.sankeyLinkHorizontal === 'function';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str == null ? '' : str);
        return div.innerHTML;
    }

    function formatAmount(amount) {
        const abs = Math.abs(amount);
        let formatted;
        if (abs >= 1000000) formatted = (abs / 1000000).toFixed(1) + 'M';
        else if (abs >= 1000) formatted = abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        else formatted = abs.toFixed(2);
        return (amount < 0 ? '-' : '') + formatted;
    }

    function shortAmount(val) {
        return val >= 1000000 ? (val / 1000000).toFixed(1) + 'M'
            : val >= 1000 ? (val / 1000).toFixed(1) + 'K'
                : val.toFixed(0);
    }

    function showMessage(container, message) {
        container.innerHTML = '';
        const div = document.createElement('div');
        div.className = 'sankey-message';
        div.style.cssText = 'text-align:center;padding:40px;color:var(--text-muted)';
        div.textContent = message;
        container.appendChild(div);
    }

    // Returns 'ok', 'empty' (no flows) or 'unavailable' (d3 missing)
    function render(container, data, opts) {
        opts = opts || {};
        container.innerHTML = '';
        if (!available()) {
            showMessage(container, UNAVAILABLE_MESSAGE);
            return 'unavailable';
        }

        const nodeNames = new Set();
        const rawLinks = (data && data.links) || [];
        rawLinks.forEach(l => {
            nodeNames.add(l.source);
            nodeNames.add(l.target);
        });
        const nodeNameList = Array.from(nodeNames);
        const nodeIndex = {};
        nodeNameList.forEach((name, i) => { nodeIndex[name] = i; });
        const nodes = nodeNameList.map(name => ({ name }));
        const links = rawLinks.map(l => ({
            source: nodeIndex[l.source],
            target: nodeIndex[l.target],
            value: l.amount,
            sourceName: l.source,
            targetName: l.target
        }));

        if (nodes.length === 0 || links.length === 0) {
            showMessage(container, 'No flow data for the selected filters.');
            return 'empty';
        }

        const c = OxiUI.getChartColors();
        const tooltip = opts.tooltip || null;
        const width = container.clientWidth || 1100;
        const height = container.clientHeight || Math.max(400, Math.min(600, width * 0.5));

        const svg = d3.select(container)
            .append('svg')
            .attr('viewBox', [0, 0, width, height])
            .attr('preserveAspectRatio', 'xMidYMid meet');

        const sourceNames = [...new Set(links.map(l => l.sourceName))];
        const colorScale = d3.scaleOrdinal(OxiUI.getSeriesPalette()).domain(sourceNames);

        const graph = d3.sankey()
            .nodeWidth(14)
            .nodePadding(12)
            .extent([[10, 10], [width - 10, height - 10]])
            .nodeAlign(d3.sankeyLeft)({
                nodes: nodes.map(d => Object.assign({}, d)),
                links: links.map(d => Object.assign({}, d))
            });

        const placeTooltip = (event) => {
            tooltip.style.left = (event.clientX + 12) + 'px';
            tooltip.style.top = (event.clientY - 10) + 'px';
        };

        svg.append('g')
            .attr('fill', 'none')
            .attr('stroke-width', 1)
            .selectAll('path')
            .data(graph.links)
            .join('path')
            .attr('class', 'sankey-link')
            .attr('d', d3.sankeyLinkHorizontal())
            .attr('stroke', d => {
                const col = colorScale(d.source.name);
                const r = parseInt(col.slice(1, 3), 16);
                const g = parseInt(col.slice(3, 5), 16);
                const b = parseInt(col.slice(5, 7), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',0.35)';
            })
            .attr('stroke-width', d => Math.max(1, d.width))
            .style('cursor', 'pointer')
            .on('mouseover', function (event, d) {
                d3.select(this).attr('stroke-opacity', 0.7);
                if (tooltip) {
                    tooltip.style.display = 'block';
                    tooltip.innerHTML = '<strong>' + escapeHtml(d.source.name) + '</strong><br>' +
                        '→ ' + escapeHtml(d.target.name) + '<br>' + formatAmount(d.value);
                    placeTooltip(event);
                }
            })
            .on('mousemove', function (event) {
                if (tooltip) placeTooltip(event);
            })
            .on('mouseout', function () {
                d3.select(this).attr('stroke-opacity', 0.35);
                if (tooltip) tooltip.style.display = 'none';
            });

        const nodeGroup = svg.append('g')
            .selectAll('g')
            .data(graph.nodes)
            .join('g')
            .attr('class', 'sankey-node');

        nodeGroup.append('rect')
            .attr('height', d => Math.max(d.y1 - d.y0, 4))
            .attr('width', 14)
            .attr('fill', d => d.depth === 0 ? colorScale(d.name) : c.neutral)
            .attr('rx', 3)
            .attr('stroke', c.tooltipBorder)
            .style('cursor', 'pointer');

        nodeGroup.append('text')
            .attr('class', 'sankey-label')
            .attr('x', d => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
            .attr('y', d => d.y0 + 4)
            .attr('dy', '0.35em')
            .attr('fill', c.tooltipText)
            .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
            .attr('font-size', '11px')
            .attr('pointer-events', 'none')
            .text(d => d.name.length > 25 ? d.name.substring(0, 25) + '…' : d.name);

        nodeGroup.append('text')
            .attr('class', 'sankey-amount')
            .attr('fill', c.textColor)
            .attr('x', d => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
            .attr('y', d => d.y1 - 2)
            .attr('text-anchor', d => d.x0 < width / 2 ? 'start' : 'end')
            .attr('font-size', '10px')
            .attr('pointer-events', 'none')
            .text(d => shortAmount(d.value || 0));

        return 'ok';
    }

    window.OxiSankey = {
        available: available,
        unavailableMessage: UNAVAILABLE_MESSAGE,
        render: render
    };
})();
