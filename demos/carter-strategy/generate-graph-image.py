#!/usr/bin/env python3
"""
Generate SVG and PNG visualizations from carter-strategy.graphml.

Requires: pip install networkx matplotlib

Usage: python3 generate-graph-image.py
Output: carter-strategy-graph.svg, carter-strategy-graph.png
"""

import os
import sys
import networkx as nx
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
GRAPHML_PATH = SCRIPT_DIR / 'carter-strategy.graphml'
SVG_PATH = SCRIPT_DIR / 'carter-strategy-graph.svg'
PNG_PATH = SCRIPT_DIR / 'carter-strategy-graph.png'

# Category -> color mapping
CATEGORY_COLORS = {
    'people': '#4A90D9',      # blue
    'person': '#4A90D9',
    'projects': '#48B685',    # green
    'project': '#48B685',
    'technology': '#9B59B6',  # purple
    'concept': '#9B59B6',
    'documents': '#E67E22',   # orange
    'finance': '#F1C40F',     # yellow
    'health': '#E74C3C',      # red
}
NOTE_COLOR = '#CCCCCC'        # gray for note nodes
DEFAULT_ENTITY_COLOR = '#95A5A6'  # dark gray for uncategorized entities

def main():
    if not GRAPHML_PATH.exists():
        print(f'Error: {GRAPHML_PATH} not found. Run tests first to generate it.')
        sys.exit(1)

    G = nx.read_graphml(str(GRAPHML_PATH))
    print(f'Loaded graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges')

    # Separate entity and note nodes
    entity_nodes = [n for n, d in G.nodes(data=True) if d.get('type') == 'entity']
    note_nodes = [n for n, d in G.nodes(data=True) if d.get('type') == 'note']

    # Node colors
    node_colors = []
    for n in G.nodes():
        d = G.nodes[n]
        if d.get('type') == 'note':
            node_colors.append(NOTE_COLOR)
        else:
            cat = d.get('category', '').lower()
            node_colors.append(CATEGORY_COLORS.get(cat, DEFAULT_ENTITY_COLOR))

    # Node sizes: entities by degree, notes small
    degrees = dict(G.degree())
    node_sizes = []
    for n in G.nodes():
        d = G.nodes[n]
        if d.get('type') == 'entity':
            node_sizes.append(max(200, degrees.get(n, 1) * 80))
        else:
            node_sizes.append(60)

    # Labels: only entity nodes with degree >= 2
    labels = {}
    for n in G.nodes():
        d = G.nodes[n]
        if d.get('type') == 'entity' and degrees.get(n, 0) >= 2:
            labels[n] = d.get('label', n.split(':')[-1])

    # Layout
    pos = nx.spring_layout(G, k=2.0, iterations=100, seed=42)

    # Draw
    fig, ax = plt.subplots(1, 1, figsize=(20, 14))
    fig.patch.set_facecolor('white')
    ax.set_facecolor('white')

    # Draw edges (faint)
    edge_colors = []
    for u, v, d in G.edges(data=True):
        et = d.get('edge_type', 'wikilink')
        if et == 'cooccurrence':
            edge_colors.append('#E8D5B7')
        elif et == 'weighted':
            edge_colors.append('#B8D4E3')
        else:
            edge_colors.append('#D0D0D0')

    nx.draw_networkx_edges(G, pos, alpha=0.3, edge_color=edge_colors,
                           arrows=True, arrowsize=8, width=0.5, ax=ax)

    # Draw note nodes (small, in background)
    nx.draw_networkx_nodes(G, pos, nodelist=note_nodes, node_size=[node_sizes[list(G.nodes()).index(n)] for n in note_nodes],
                           node_color=[node_colors[list(G.nodes()).index(n)] for n in note_nodes],
                           alpha=0.3, ax=ax)

    # Draw entity nodes (prominent)
    nx.draw_networkx_nodes(G, pos, nodelist=entity_nodes, node_size=[node_sizes[list(G.nodes()).index(n)] for n in entity_nodes],
                           node_color=[node_colors[list(G.nodes()).index(n)] for n in entity_nodes],
                           alpha=0.85, edgecolors='white', linewidths=1.0, ax=ax)

    # Draw labels
    nx.draw_networkx_labels(G, pos, labels, font_size=7, font_weight='bold', ax=ax)

    # Legend
    from matplotlib.patches import Patch
    legend_items = [
        Patch(facecolor='#4A90D9', label='People'),
        Patch(facecolor='#48B685', label='Projects'),
        Patch(facecolor='#E67E22', label='Documents'),
        Patch(facecolor='#9B59B6', label='Concepts'),
        Patch(facecolor='#F1C40F', label='Finance'),
        Patch(facecolor=NOTE_COLOR, label='Notes'),
    ]
    ax.legend(handles=legend_items, loc='upper left', fontsize=8, framealpha=0.8)

    ax.set_title('Carter Strategy — Knowledge Graph (exported via Flywheel Memory)', fontsize=14, pad=20)
    ax.axis('off')

    plt.tight_layout()
    plt.savefig(str(SVG_PATH), format='svg', bbox_inches='tight', facecolor='white')
    plt.savefig(str(PNG_PATH), format='png', dpi=150, bbox_inches='tight', facecolor='white')

    print(f'Saved: {SVG_PATH}')
    print(f'Saved: {PNG_PATH}')
    print(f'Entities: {len(entity_nodes)}, Notes: {len(note_nodes)}, Edges: {G.number_of_edges()}')

if __name__ == '__main__':
    main()
