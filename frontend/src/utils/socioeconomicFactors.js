export const SOCIOECONOMIC_FIELDS = [
  ['educationalSpecialNeeds', 'Educational Support Needs'],
  ['tuitionFeeStatus', 'Tuition Fees Up to Date'],
  ['scholarshipStatus', 'Active Scholarship'],
];

export const factorLabel = value => typeof value === 'boolean' ? (value ? 'Yes' : 'No') : 'Not provided';
