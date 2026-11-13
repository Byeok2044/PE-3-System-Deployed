require('dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
const { getConfig, sendEmail } = require('../src/utils/mailjet');
const { publicUrl } = require('../src/utils/publicUrl');

async function checkMailjet() {
  const { senderEmail } = getConfig();
  const appUrl = publicUrl('/login');
  await sendEmail({
    to: { email: senderEmail },
    subject: 'Retainify email configuration check',
    html: `<p>Retainify configuration check.</p><a href="${appUrl}">Open Retainify</a>`,
    text: `Retainify configuration check: ${appUrl}`,
  }, { sandbox: true });
  console.log('Mailjet accepted the sandbox check. No email was sent.');
  console.log(`Application URL: ${appUrl}`);
  console.log('Click and open tracking: disabled.');
}

if (require.main === module) {
  checkMailjet().catch(error => {
    console.error(error.message);
    if (error.providerStatus || error.code) console.error(`Status: ${error.providerStatus || 'configuration'}; code: ${error.code || 'unknown'}`);
    process.exitCode = 1;
  });
}
module.exports = { checkMailjet };
