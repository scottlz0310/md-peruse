# Choose the Next Step from the Evidence

When there are many candidates, weigh the expected impact against how easy each one is to take on.
Here we define a simple priority score for a fictional improvement plan.

## The priority model

Let $I$ be impact, $C$ be confidence, and $E$ be effort. The score $S$ is:

$$
S = \frac{I \times C}{E}, \qquad E > 0
$$

The number is a starting point for discussion. Don't decide on the score alone; check the assumptions too.

## Expressed in TypeScript

```typescript
type Improvement = {
  name: string;
  impact: number;
  confidence: number;
  effort: number;
};

function priority(item: Improvement): number {
  if (item.effort <= 0) {
    throw new Error("Effort must be a positive value");
  }
  return (item.impact * item.confidence) / item.effort;
}
```

**Takeaway:** Align your units, and write down the reasoning behind your confidence.

[Back to the project overview](01-project-overview.md)
