# UK Trade Leads Meta reporting reconciliation

Source: the `UK Trade Leads | AG Digital Studio` Ads Manager account (1357893439073996), selected by calendar month in London time on 9 September 2026.

## Meta account history

- Meta Ads Manager maximum-date total: **£12,743.00 spent**, **652 Website leads**, **£19.54 per Website lead**.
- Recent direct Ads Manager 30-day view (10 August–8 September 2026): **£1,497.08 spent**, **41 Website leads**, **£36.51 per Website lead**.

The corresponding direct calendar-month rows are in `uktl-meta-ads-manager-monthly-2025-12_to_2026-08.csv`.

## Dashboard reconciliation

The prior dashboard stored daily rows but withheld totals whenever Meta omitted the configured lead action on a zero-result day. The deployed correction treats an explicit empty action list as zero while preserving an unknown result for an omitted action field or a conflicting lead-like action.

After deployment and a live sync on 9 September 2026, the dashboard reports 17 Meta Lead events at £18.81 in its current seven-day window. This is a lead-event metric, not unique contacts or booked calls.
