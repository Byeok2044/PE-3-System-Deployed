import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export default function AcademicTrajectoryChart({ currentGrade, predictedGrade, gradeDetails }) {
  const { chartDomain, isReversed, passingCutoff, isAtRisk } = gradeDetails;
  const color = isAtRisk ? "#d55752" : "#0c5bb4";
  const data = [
    { term: "Current Term", grade: currentGrade },
    ...(Number.isFinite(predictedGrade)
      ? [{ term: "Next Term (ML)", grade: predictedGrade }]
      : []),
  ];

  return (
    <div className="trajectory-chart-box">
      <div className="trajectory-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="term" stroke="#64748b" fontSize={11} />
            <YAxis
              domain={chartDomain}
              reversed={isReversed}
              stroke="#64748b"
              fontSize={11}
            />
            <Tooltip formatter={(value) => [value, "Grade"]} />
            <ReferenceLine
              y={passingCutoff}
              label={{
                value: `Cutoff (${passingCutoff})`,
                fill: "#d55752",
                fontSize: 10,
                dy: 18,
                position: "insideBottomRight",
              }}
              stroke="#d55752"
              strokeDasharray="3 3"
            />
            <Line
              type="monotone"
              dataKey="grade"
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 4, fill: color }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
