"use client";

import Link from "next/link";
import { useI18n } from "@/app/portal/lib/preferences-context";
import { useTenant } from "@/app/portal/lib/use-tenant";
import { skillHelpCopy } from "./skills-help-copy";
import styles from "./skills-help.module.css";

export function SkillsHelp() {
  const { language } = useI18n();
  const tenant = useTenant();
  const copy = skillHelpCopy(language);

  return (
    <div className={styles.page}>
      <Link className={styles.back} href={`/portal/${tenant}/skills` as never}>
        ← {copy.back}
      </Link>
      <header className={styles.header}>
        <h1>{copy.title}</h1>
        <p>{copy.introduction}</p>
      </header>
      <div className={styles.layout}>
        <nav className={styles.contents} aria-label={copy.contents}>
          <p>{copy.contents}</p>
          {copy.sections.map((section) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
          <Link href={`/portal/${tenant}/workflows` as never}>
            {copy.workflowLink} →
          </Link>
        </nav>
        <div className={styles.article}>
          {copy.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
            >
              <h2 id={`${section.id}-title`}>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.steps && (
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {section.example && (
                <pre>
                  <code>{section.example}</code>
                </pre>
              )}
              {section.table && (
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        {section.table.headings.map((heading) => (
                          <th key={heading} scope="col">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.table.rows.map(([label, detail]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <td>{detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
