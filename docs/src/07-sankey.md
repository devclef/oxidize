# Sankey Flow

The Sankey page (`/sankey`) visualizes money movement between source accounts and spending categories using a Sankey diagram powered by d3.

## Overview

The Sankey diagram shows:

- **Source accounts** on the left - where money came from
- **Destination categories** on the right - where money went
- **Link width** proportional to the amount transferred or spent

## Filters

- **Date range** - select start and end dates
- **Account groups** - filter to specific groups of accounts

## Saving as Widget

Click **"Save as Widget"** to pin the current Sankey configuration to your dashboard.

## API

```
GET /api/sankey/flows?start=2026-01-01&end=2026-06-01&accounts[]=1
```
