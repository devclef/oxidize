# Sankey Flow

Sankey flow diagrams show how money moves from source accounts to where it
went, drawn with d3. They are a dashboard widget type: build one in the
Widget Builder (`/`).

## Overview

The Sankey diagram shows:

- **Source accounts** on the left - where money came from
- **Destinations** on the right - destination accounts, categories,
  subcategories or budgets (the widget's **flow type**)
- **Link width** proportional to the amount transferred or spent

## Building a Sankey widget

1. In the Widget Builder, pick the **Sankey Flow** type.
2. Select the source accounts (or groups) and a date range.
3. Choose the **flow type** and, optionally, categories or budgets to exclude.
4. Check the preview, name the widget and save it.

On the dashboard the widget's settings can change all of these later.

The diagram is drawn with d3, loaded from a CDN. If it is blocked (offline or
by a content blocker) the widget says so instead of drawing.

> The standalone Sankey Flow page (`/sankey`) was retired; the address now
> redirects to the Widget Builder.

## API

```
GET /api/sankey/flows?start=2026-01-01&end=2026-06-01&accounts[]=1&flow_type=category
```
