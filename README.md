# Sergey AI Trader PRO Dashboard

Static production Dashboard for the Sergey AI Trader PRO market scanner. The
application is implemented in `index.html` and consumes the separate Vercel API;
it does not calculate or modify trading signals in the browser.

## Main sections

- Core markets and the global 434-market scanner.
- Opportunity Score, grade, direction, action, Signal Confidence, and
  Recommendation Confidence.
- Market Summary and the current global best opportunity.
- Rolling 24-hour ranking analytics.
- Cumulative Win Rate, Loss Rate, Profit Factor, and separate A+ statistics.
- Active plans and the latest 20 Completed Trades.
- Outcome evidence from OKX one-minute candles.
- AI assistant based on current Dashboard data.

The scanner displays ten results per page and reports the full matched-market
count. Browser refreshes read cached backend data; the full ranking itself is
updated by the backend QStash schedule every six minutes.

## Result interpretation

- TP1 before Stop Loss is a win.
- Stop Loss first is a loss.
- A same-candle TP1 and Stop Loss touch is treated conservatively as a loss.
- Completed Trades shows only the latest 20 details, while the Win/Loss totals
  continue accumulating in Redis.
- `Проверено: OKX 1m · N свеч. · Low … / High …` identifies candle-based outcome
  verification. Older records without candle evidence display
  `Проверено по снимку рейтинга`.

## Validation

```bash
npm test
```

The validator checks the HTML structure, inline JavaScript syntax, Completed
Trades and AI sections, Recommendation Confidence, and the full scanner-count
display. GitHub Actions runs it on every push to `main` and pull request.

## Production verification

After a frontend or backend deployment, confirm:

- Dashboard status is Online.
- The scanner reports the complete market count and expected page count.
- Recommendation Confidence contains numeric values after a full ranking cycle.
- Win/Loss totals survive a page reload and continue increasing only for unique
  completed trades.
- Completed Trades shows no more than 20 detailed records.
- Mobile tables remain contained within the viewport.

Production: `https://sergey-ai-dashboard.vercel.app/`
