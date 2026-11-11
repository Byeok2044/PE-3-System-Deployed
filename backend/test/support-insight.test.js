const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const StudentActivity = require('../src/models/StudentActivity');
const { promptFor, validateSupportInsight } = require('../src/utils/supportInsight');
const { generateMySupportInsight } = require('../src/controllers/insightController');
const workspaceService = require('../src/utils/academicWorkspace');
const User = require('../src/models/User');

const record = { previousSemesterGrade: 9, gradeMaximum: 20, attendance: 'day' };
const forecast = {
  riskLevel: 'high', dropoutProbability: 0.4727, predictedNextSemesterGrade: 11.99, gradeMaximum: 20,
  riskExplanation: { available: true, factors: [
    { key: 'previousGrade', label: 'Previous-semester grade', value: '9 / 20', direction: 'increases_risk', contributionPercentagePoints: 15 },
    { key: 'tuitionStatus', label: 'Tuition-fee status', value: 'Fees not up to date', direction: 'increases_risk', contributionPercentagePoints: 8 },
    { key: 'courseCompletion', label: 'Course completion and study load', value: '18 of 18 units passed', direction: 'decreases_risk', contributionPercentagePoints: -10 },
  ] },
};
const responseInsight = () => ({
  summary: 'Your estimated dropout probability is 47.27%, in the high-risk tier.',
  riskReasons: [
    { factorKey: 'previousGrade', explanation: 'Your recorded grade raised the model estimate.' },
    { factorKey: 'tuitionStatus', explanation: 'The recorded fee status also raised the estimate.' },
  ],
  protectiveFactors: [{ factorKey: 'courseCompletion', explanation: 'Your completed units lowered the model estimate.' }],
  strengths: ['You passed all 18 units.'],
  suggestedActions: [{ factorKey: 'previousGrade', action: 'Discuss difficult subjects with your professor and make a study plan.' }],
  discussionQuestions: ['Which subjects should I prioritize?'],
  disclaimer: 'This is an estimate for support, not a decision or diagnosis.',
});

test('prompt requires verified reasons, directions and actions linked to the largest contributors', () => {
  const prompt = promptFor({ record, forecast, inputVersion: "current-version" });
  assert.match(prompt, /riskReasons must contain exactly these factorKey values.*previousGrade.*tuitionStatus/);
  assert.match(prompt, /protectiveFactors must contain exactly these factorKey values.*courseCompletion/);
  assert.match(prompt, /NOT an input to the dropout-risk model/);
  assert.match(prompt, /NOT attendance rate/);
  assert.match(prompt, /not proven causes/);
  assert.match(prompt, /SHAP contributions only as internal evidence/);
  assert.match(prompt, /without mentioning SHAP, baseline probabilities, or exact percentage-point contributions/);
  assert.ok(prompt.includes(JSON.stringify(forecast)));
});

test('validated narratives retain trusted labels, values and numerical evidence', () => {
  const insight = validateSupportInsight(responseInsight(), forecast);
  assert.equal(insight.riskReasons[0].factorLabel, 'Previous-semester grade');
  assert.equal(insight.riskReasons[0].recordValue, '9 / 20');
  assert.equal(insight.riskReasons[0].contributionPercentagePoints, 15);
  assert.equal(insight.suggestedActions[0].factorLabel, 'Previous-semester grade');
  assert.equal(insight.explanationStatus, 'available');
});

for (const [name, alter] of [
  ['invented risk factor', (insight) => { insight.riskReasons[0].factorKey = 'absenteeism'; }],
  ['reversed factor direction', (insight) => { insight.protectiveFactors[0].factorKey = 'previousGrade'; }],
  ['missing reasons', (insight) => { insight.riskReasons = []; }],
  ['unrelated action', (insight) => { insight.suggestedActions[0].factorKey = 'sleepDuration'; }],
  ['too many actions', (insight) => { insight.suggestedActions = Array(4).fill(insight.suggestedActions[0]); }],
]) {
  test(`rejects ${name}`, () => {
    const insight = responseInsight(); alter(insight);
    assert.throws(() => validateSupportInsight(insight, forecast), SyntaxError);
  });
}

test('old forecasts permit general support but never fabricated model reasons', () => {
  const legacy = { ...forecast, riskExplanation: undefined };
  assert.match(promptFor({ record, forecast: legacy }), /no verified factor explanations/);
  assert.throws(() => validateSupportInsight(responseInsight(), legacy), SyntaxError);
  const insight = {
    ...responseInsight(), riskReasons: [], protectiveFactors: [],
    suggestedActions: [{ factorKey: 'generalSupport', action: 'Run a new forecast and speak with your adviser.' }],
  };
  assert.equal(validateSupportInsight(insight, legacy).explanationStatus, 'unavailable');
});

test('inverse grade scale instructions retain the correct direction and passing standard', () => {
  const prompt = promptFor({ record, forecast: { ...forecast, gradeMaximum: 5, predictedNextSemesterGrade: 4.12 } });
  assert.match(prompt, /Lower numbers are better/);
  assert.match(prompt, /below the passing standard/);
});

const restores = [];
function stub(object, key, value) {
  const original = object[key]; object[key] = value;
  restores.push(() => { object[key] = original; });
}
afterEach(() => { while (restores.length) restores.pop()(); });

for (const valid of [true, false]) {
  test(`controller ${valid ? 'saves verified Gemini reasons' : 'rejects unsupported Gemini output before saving'}`, async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    restores.push(() => {
      if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = originalKey;
    });
    stub(workspaceService, 'loadWorkspace', async () => ({ inputVersion: 'current-version' }));
    stub(User, 'findById', async () => ({ _id: 'current-student' }));
    stub(StudentActivity, 'findOne', (filter) => {
      assert.equal(filter.student, 'current-student');
      return { sort: () => ({ lean: async () => ({ record, forecast, inputVersion: "current-version" }) }) };
    });
    let saved;
    stub(StudentActivity, 'create', async (activity) => { saved = activity; return { createdAt: 'now' }; });
    stub(axios, 'post', async (url, body) => {
      assert.match(url, /generativelanguage\.googleapis\.com/);
      assert.ok(body.generationConfig.responseSchema.required.includes('riskReasons'));
      const insight = responseInsight();
      if (!valid) insight.riskReasons[0].factorKey = 'invented';
      return { data: { candidates: [{ content: { parts: [{ text: JSON.stringify(insight) }] } }] } };
    });
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await generateMySupportInsight({ user: { _id: 'current-student', role: 'student' } }, res, (error) => { throw error; });
    assert.equal(res.code, valid ? 201 : 502);
    if (valid) {
      assert.equal(saved.insight.promptVersion, 'student-support-v2-model-reasons');
      assert.equal(saved.forecast, forecast);
      assert.equal(res.body.insight.riskReasons[0].factorLabel, 'Previous-semester grade');
    } else assert.equal(saved, undefined);
  });
}
