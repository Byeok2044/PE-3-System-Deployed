import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../styles/Legal.css";
import BrandLogo from "../components/BrandLogo";

const LAST_UPDATED = "August 20, 2026";

const PrivacyPolicy = () => {
  const [searchParams] = useSearchParams();
  const isEmbedded = searchParams.get("embed") === "1";

  return (
    <div className="legal-page">
      <header className="legal-header">
        <BrandLogo className="legal-logo" />
        {!isEmbedded && (
          <Link to="/" className="legal-back-link">
            Back to home
          </Link>
        )}
      </header>

      <div className="legal-content">
        <aside className="legal-toc">
          <p className="legal-toc-title">On this page</p>
          <a href="#introduction">1. Introduction</a>
          <a href="#definitions">2. Key Definitions</a>
          <a href="#data-collected">3. Personal Data We Collect</a>
          <a href="#legal-basis">4. Legal Basis for Processing</a>
          <a href="#how-we-use">5. How We Use Personal Data</a>
          <a href="#sharing">6. Sharing &amp; Disclosure</a>
          <a href="#retention">7. Data Retention</a>
          <a href="#security">8. Data Security</a>
          <a href="#breach">9. Data Breach Notification</a>
          <a href="#rights">10. Your Rights as a Data Subject</a>
          <a href="#minors">11. Data of Minors</a>
          <a href="#cookies">12. Cookies &amp; Tracking</a>
          <a href="#transfers">13. Cross-Border Data Transfers</a>
          <a href="#changes">14. Changes to This Policy</a>
          <a href="#contact">15. Contact Us &amp; the NPC</a>
        </aside>

        <main className="legal-main">
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Last updated: {LAST_UPDATED}</p>

          <p className="legal-intro">
            This Privacy Policy explains how the Student Academic Attrition Risk
            Classification &amp; Performance Forecasting System
            (&quot;Retainify,&quot; &quot;we,&quot; &quot;us,&quot; or
            &quot;our&quot;) collects, uses, discloses, and protects personal
            data. This Policy is written to comply with the{" "}
            <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>,
            its Implementing Rules and Regulations, and applicable circulars and
            advisory opinions issued by the{" "}
            <strong>National Privacy Commission (NPC)</strong> of the
            Philippines.
          </p>

          <section id="introduction">
            <h2>1. Introduction</h2>
            <p>
              Retainify processes academic records, attendance data, and
              related information on behalf of participating educational
              institutions in order to identify students at risk of attrition
              and to forecast academic performance. In most cases, your
              institution is the{" "}
              <strong>Personal Information Controller</strong> that determines
              what data is collected and why, and Retainify acts as a{" "}
              <strong>Personal Information Processor</strong> on the
              institution&apos;s behalf. Where we determine the purposes and
              means of processing ourselves (for example, for account
              administration and system security), we act as a controller for
              that limited processing.
            </p>
          </section>

          <section id="definitions">
            <h2>2. Key Definitions</h2>
            <p>
              As used in this Policy, terms defined under RA 10173 apply,
              including:
            </p>
            <ul>
              <li>
                <strong>Personal Information</strong> — any information from
                which the identity of an individual is apparent, or can be
                reasonably and directly ascertained, or when combined with other
                information would directly identify an individual.
              </li>
              <li>
                <strong>Sensitive Personal Information</strong> — includes
                information about an individual&apos;s education, and any
                information issued by government agencies unique to an
                individual (e.g., government ID numbers), among the categories
                defined under RA 10173, Section 3(l).
              </li>
              <li>
                <strong>Data Subject</strong> — the individual whose personal
                information is processed (e.g., a student or professor).
              </li>
              <li>
                <strong>Processing</strong> — any operation performed on
                personal data, including collection, recording, storage, use,
                and disclosure.
              </li>
            </ul>
          </section>

          <section id="data-collected">
            <h2>3. Personal Data We Collect</h2>
            <p>Depending on your role, we may process:</p>
            <ul>
              <li>
                <strong>Account &amp; identity data:</strong> full name,
                institutional email address, institution name, role (Student,
                or Professor).
              </li>
              <li>
                <strong>Academic data:</strong> grades, GPA history, course
                enrollment, attendance records, and academic standing, provided
                by your institution or entered by authorized staff.
              </li>
              <li>
                <strong>Derived data:</strong> attrition risk scores,
                performance forecasts, and analytics generated by our models
                based on the data above.
              </li>
              <li>
                <strong>Technical data:</strong> login timestamps, IP address,
                device and browser information, and system usage logs, collected
                for security and audit purposes.
              </li>
            </ul>
            <p>
              Academic performance and enrollment records are treated as{" "}
              <strong>sensitive personal information</strong> under RA 10173 and
              are handled with the corresponding heightened protections
              described in this Policy.
            </p>
          </section>

          <section id="legal-basis">
            <h2>4. Legal Basis for Processing</h2>
            <p>
              We process personal data on one or more of the following bases,
              consistent with RA 10173:
            </p>
            <ul>
              <li>
                <strong>Consent</strong> of the data subject, obtained prior to
                or as soon as practicable after collection;
              </li>
              <li>
                Processing necessary to <strong>fulfill our contract</strong>{" "}
                with your institution to provide the System;
              </li>
              <li>
                Compliance with a <strong>legal obligation</strong> to which we
                or your institution are subject;
              </li>
              <li>
                Processing necessary for the{" "}
                <strong>legitimate interests</strong> of your institution in
                supporting student retention and success, provided such
                interests do not override your fundamental rights.
              </li>
            </ul>
          </section>

          <section id="how-we-use">
            <h2>5. How We Use Personal Data</h2>
            <ul>
              <li>
                To generate attrition risk classifications and performance
                forecasts;
              </li>
              <li>
                To provide dashboards and reports to authorized professors;
              </li>
              <li>To create, authenticate, and manage user accounts;</li>
              <li>
                To maintain the security, integrity, and audit trail of the
                System;
              </li>
              <li>
                To communicate service updates, password resets, and
                account-related notices;
              </li>
              <li>
                To comply with legal, regulatory, or institutional reporting
                obligations.
              </li>
            </ul>
            <p>
              We do not use personal data for advertising, and we do not sell
              personal data to third parties.
            </p>
          </section>

          <section id="sharing">
            <h2>6. Sharing &amp; Disclosure</h2>
            <p>We may share personal data with:</p>
            <ul>
              <li>
                <strong>Your institution&apos;s authorized personnel</strong>{" "}
                (e.g., professors), limited to what is
                necessary for their role;
              </li>
              <li>
                <strong>Service providers</strong> who process data on our
                behalf (such as hosting and infrastructure providers), under
                confidentiality and data processing agreements consistent with
                RA 10173;
              </li>
              <li>
                <strong>Government agencies or regulators</strong>, including
                the National Privacy Commission, when required by law or valid
                legal process.
              </li>
            </ul>
            <p>
              We do not disclose sensitive personal information to third parties
              without a legal basis or your consent, except as required by law.
            </p>
          </section>

          <section id="retention">
            <h2>7. Data Retention</h2>
            <p>
              We retain personal data only for as long as necessary to fulfill
              the purposes described in this Policy, to comply with our
              contractual obligations to your institution, or as required by
              applicable law. When data is no longer needed, it is securely
              disposed of or anonymized in accordance with NPC guidelines on
              data retention and disposal.
            </p>
          </section>

          <section id="security">
            <h2>8. Data Security</h2>
            <p>
              Consistent with RA 10173&apos;s requirement of reasonable and
              appropriate organizational, physical, and technical security
              measures, we implement safeguards including:
            </p>
            <ul>
              <li>Encryption of data in transit and at rest;</li>
              <li>
                Role-based access controls limiting data visibility by user
                role;
              </li>
              <li>Authentication safeguards for account access;</li>
              <li>
                Regular monitoring, logging, and vulnerability assessment of our
                systems;
              </li>
              <li>
                Confidentiality obligations for personnel with access to
                personal data.
              </li>
            </ul>
          </section>

          <section id="breach">
            <h2>9. Data Breach Notification</h2>
            <p>
              In the event of a personal data breach that poses a real risk of
              serious harm to affected data subjects, we will notify the
              National Privacy Commission and affected data subjects within the
              timeframe required under RA 10173 and its Implementing Rules and
              Regulations (generally within 72 hours of knowledge of the
              breach), and will coordinate with your institution as the
              controller where applicable.
            </p>
          </section>

          <section id="rights">
            <h2>10. Your Rights as a Data Subject</h2>
            <p>Under RA 10173, you have the right to:</p>
            <ul>
              <li>
                <strong>Be informed</strong> that your personal data will be, is
                being, or was processed;
              </li>
              <li>
                <strong>Access</strong> your personal data upon reasonable
                request;
              </li>
              <li>
                <strong>Object</strong> to the processing of your personal data,
                including processing for direct marketing or profiling;
              </li>
              <li>
                <strong>Correct</strong> inaccurate or outdated personal data;
              </li>
              <li>
                <strong>Erasure or blocking</strong> of your personal data upon
                discovery of unlawful processing, or when data is no longer
                necessary for the purpose collected;
              </li>
              <li>
                <strong>Data portability</strong>, to obtain a copy of your data
                in an electronic format, where technically feasible;
              </li>
              <li>
                <strong>Damages</strong>, to be indemnified for damages
                sustained due to inaccurate, incomplete, or unlawfully obtained
                personal data;
              </li>
              <li>
                <strong>File a complaint</strong> with the National Privacy
                Commission if you believe your rights have been violated.
              </li>
            </ul>
            <p>
              To exercise any of these rights, contact us using the details in
              Section 15. Where your institution is the controller of your data,
              we will coordinate with them to respond to your request.
            </p>
          </section>

          <section id="minors">
            <h2>11. Data of Minors</h2>
            <p>
              Some students using Retainify may be minors. Where required,
              we rely on the applicable consent and safeguards under RA 10173
              for processing the personal data of minors, generally obtained
              through the enrolling institution or, where required, a parent or
              legal guardian. We limit the personal data of minors we process to
              what is necessary for the academic purposes described in this
              Policy.
            </p>
          </section>

          <section id="cookies">
            <h2>12. Cookies &amp; Tracking</h2>
            <p>
              We use strictly necessary cookies and similar technologies to keep
              you signed in, remember your session, and maintain the security of
              the System. We do not use third-party advertising cookies.
            </p>
          </section>

          <section id="transfers">
            <h2>13. Cross-Border Data Transfers</h2>
            <p>
              If personal data is stored or processed outside the Philippines
              (for example, by a cloud hosting provider), we require that the
              recipient maintain a comparable level of protection to that
              required under RA 10173, through contractual, organizational, and
              technical safeguards.
            </p>
          </section>

          <section id="changes">
            <h2>14. Changes to This Policy</h2>
            <p>
              We may update this Policy from time to time to reflect changes in
              our practices or legal requirements. Material changes will be
              communicated through the System or by email, and the &quot;Last
              updated&quot; date above will be revised accordingly.
            </p>
          </section>

          <section id="contact">
            <h2>15. Contact Us &amp; the NPC</h2>
            <p>
              To exercise your data privacy rights or to ask questions about
              this Policy, contact our Data Protection Officer through the Help
              &amp; Support link in the footer, or your institution&apos;s
              Retainify support team.
            </p>
            <p>
              If you believe your concern has not been adequately addressed, you
              may file a complaint with the{" "}
              <strong>National Privacy Commission</strong> of the Philippines at{" "}
              <a
                href="https://www.privacy.gov.ph"
                target="_blank"
                rel="noopener noreferrer"
              >
                privacy.gov.ph
              </a>
              .
            </p>
          </section>

          <p className="legal-disclaimer">
            This page is a general template and does not constitute legal
            advice. Before publishing, have it reviewed by counsel familiar with
            Philippine data privacy law, your institution&apos;s Data Sharing
            Agreement, and your Data Protection Officer&apos;s registered
            privacy manual with the NPC.
          </p>
        </main>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
