const percent = (value) => `${(Number(value) * 100).toFixed(2)}%`;

function effectLabel(factor) {
  const points = Math.abs(factor.contributionPercentagePoints);
  if (!points) return 'No net effect';
  const amount = points < 0.005 ? 'less than 0.01' : points.toFixed(2);
  return `${factor.direction === 'increases_risk' ? 'Raises' : 'Lowers'} by ${amount} percentage points`;
}

export default function RiskExplanation({ explanation }) {
  if (!explanation?.available) {
    return (
      <section className="risk-explanation" aria-labelledby="risk-explanation-title">
        <h3 id="risk-explanation-title">What is behind your risk estimate?</h3>
        <p>This saved forecast does not include model-based reasons. Run a new forecast to see which factors raise or lower your estimate.</p>
      </section>
    );
  }

  return (
    <section className="risk-explanation" aria-labelledby="risk-explanation-title">
      <h3 id="risk-explanation-title">What is behind your risk estimate?</h3>
      <p>{explanation.tierExplanation}</p>
      <p>
        The model started at <strong>{percent(explanation.baselineProbability)}</strong> before considering your information.
        The factors below brought your estimate to <strong>{percent(explanation.predictedProbability)}</strong>.
        Some factors can lower your estimate while others raise it.
      </p>
      <div className="risk-explanation__table-wrap" tabIndex={0} role="region" aria-label="Risk factor contributions">
        <table>
          <caption>Factors used in your individual risk estimate, ordered by size of contribution</caption>
          <thead><tr><th scope="col">Factor</th><th scope="col">Your record</th><th scope="col">Effect on estimate</th></tr></thead>
          <tbody>
            {explanation.factors.map((factor) => (
              <tr key={factor.key}>
                <th scope="row">{factor.label}</th>
                <td>{factor.value}</td>
                <td><span className={`risk-explanation__effect risk-explanation__effect--${factor.direction}`}>{effectLabel(factor)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>These are model associations, not proven causes of dropout or promises about how much an action will change your risk.</p>
      <details><summary>How to read these factors</summary><p>{explanation.limitations}</p></details>
    </section>
  );
}
