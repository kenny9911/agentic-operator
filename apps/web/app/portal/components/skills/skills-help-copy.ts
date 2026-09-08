export interface SkillHelpSection {
  id: string;
  title: string;
  paragraphs: string[];
  steps?: string[];
  example?: string;
  table?: { headings: [string, string]; rows: [string, string][] };
}
export interface SkillHelpCopy {
  title: string;
  introduction: string;
  back: string;
  contents: string;
  workflowLink: string;
  sections: SkillHelpSection[];
}

const en: SkillHelpCopy = {
  title: "Skills help & examples",
  introduction: "Create reusable guidance, review the evidence, and make published Skills available to the right agents. Tenant administrators create, publish and compare Skills; viewers and operators can browse and export. Skills supply instructions and resources; they do not grant business tools, credentials or script permissions.",
  back: "Back to Skills",
  contents: "On this page",
  workflowLink: "Open Workflows",
  sections: [
    {
      id: "create", title: "Create and revise",
      paragraphs: ["Describe the capability, when it should apply, its inputs and expected output, and any limits. Include a realistic task where it should apply and a nearby task where it should not.", "Creator assumptions need your review. Suggested checks have not been run; they are proposed prompts and criteria, not passing results. Model and usage details record the actual generation. After manual edits, notes may describe an earlier revision."],
      steps: ["Select Describe a skill and enter the purpose and examples. Use Tenant authoring policy or an available Model route.", "Select Create skill. The generated draft opens in the file editor.", "Review the files, assumptions and suggested checks. Edit, Validate, Save changes, then Publish version when ready.", "For an existing saved draft, choose Revise with AI. Save local edits first and review the new draft before publishing. Use Create blank to author without a model call."],
      example: "Create an order-exception-review Skill. Review supplied purchase order details for missing approvals or conflicting amounts. Return known facts, missing information and next review steps. Do not invent approval thresholds or contact suppliers. General order-status questions should not trigger it.",
    },
    {
      id: "files", title: "Write and maintain files",
      paragraphs: ["A portable bundle has a root SKILL.md with YAML name and description, followed by Markdown instructions. Use a lowercase name with hyphens. The description should explain when the Skill applies. Keep the main instructions focused; link to detailed references and templates using relative paths.", "Source edits text. Preview opens relative resource links in the editor and does not execute code, render raw HTML or load remote images. Add text file, Upload files, Rename file and Remove file maintain the bundle. Binary files are preserved as bytes and can be downloaded or replaced.", "Save changes can retain an incomplete draft. Validate checks structure, metadata and paths; it does not test task quality. Publication and ZIP export require a valid bundle. Export SKILL.md only can recover the main document from an invalid draft.", "A save conflict keeps your local edits. Copy or compare them before Reload saved draft, which replaces the local editor content."],
      example: "---\nname: order-exception-review\ndescription: Review supplied purchase order exceptions. Use for missing approvals or conflicting amounts, not general status questions.\n---\n\nUse supplied records as evidence.\nReturn known facts, missing information and next steps.\nConsult references/checklist.md when a detailed review is needed.",
    },
    {
      id: "portability", title: "Import, export and libraries",
      paragraphs: ["Import skill accepts ZIP, SKILL.md or a skill folder. Review the files and diagnostics before Add to library. An import creates a draft and does not execute or publish anything. A folder-rooted ZIP must match its declared Skill name.", "Export bundle preserves all admitted resource bytes. Export SKILL.md only omits supporting files. Exports do not transfer credentials, business tool grants, evaluation records or agent assignments; check dependencies in the destination harness.", "This tenant is private to the current Tenant. Shared library publications are available across Tenants and maintained by platform superadmins. Unpublished shared drafts remain private to the platform library. Copy to my library creates an independent Tenant draft, without automatic synchronization."],
    },
    {
      id: "versions", title: "Save, publish and history",
      paragraphs: ["Saving creates a draft revision. Publish version creates an immutable numbered publication for new runtime catalogs. A saved draft alone is not available to production runs.", "Version history shows publications and earlier drafts. Restore as draft creates a new editable revision; existing publications remain unchanged. Publish the restored content as a new version to make it the latest.", "Archive skill removes it from new catalogs while preserving history and captured runs. Restore to library makes the latest publication available again. Explicit assignments to unavailable Skills need attention; they are not silently replaced."],
    },
    {
      id: "compare", title: "Compare and review evidence",
      paragraphs: ["Open Compare skill responses, choose a saved draft revision or published version, enter a realistic task and expected criteria, then select Run comparison. Suggested checks can prefill the form; they do not start it automatically. The comparison records two real Gateway calls: the task alone, and the same task with the complete SKILL.md instructions. Inspect both outputs and each recorded Provider, model and usage; policy or fallbacks can affect routing.", "Completed means observations are ready. Read both outputs and select Save human review with Meets expectations or Does not meet expectations and a comment against the expectations. Refresh history revisits records; Cancel comparison stops a pending request. Failed or cancelled comparisons cannot be graded as completed. Each record remains tied to its exact source revision/version and content digest. Prompts and outputs stay private to the evaluating Tenant, including comparisons of shared Skills.", "No business tools, scripts, external services or bundled resource reads execute in either comparison. This does not test automatic discovery, activation or an entire Workflow. Two responses are limited evidence, and Creator suggestions are not automatically run. Test integration through a separately authorized runtime or Test Lab run."],
    },
    {
      id: "assign", title: "Assign to Workflows and Agents",
      paragraphs: ["Open Workflow Skills in the Workflow editor or Skills in Agent Studio. Save the definition and follow its normal validation/publication flow. Test Lab retains the assignments in the definition being tested and applies the same access boundaries.", "For a selected Skill, follow latest publication or pin an exact version. Latest resolves once for a new root run. An Agent under a Workflow inherits its captured version and can only narrow that scope. Load when the run starts explicitly activates the instructions; otherwise the model chooses when they apply.", "Switching modes keeps stored selections, which apply only in selected mode. Missing, archived, unpublished, outside-scope and unavailable pinned entries remain visible. Fix the Skill, pin or parent scope, or remove the assignment. A loading failure does not clear selections; Load more fetches additional catalog pages."],
      table: { headings: ["Mode", "Available scope"], rows: [
        ["Inherit available Skills", "Default. Workflows inherit published Tenant and shared Skills. Agents inherit their Workflow scope; standalone Agents inherit their Tenant and shared library."],
        ["Use selected Skills", "Only selected identities from the inherited scope. An empty selection exposes no Skills."],
        ["Disable Skills", "No Skills in this scope. A child Agent cannot re-enable them."],
      ] },
    },
    {
      id: "runtime", title: "Understand runtime loading",
      paragraphs: ["Availability starts with names and descriptions. Full instructions load when activated; references and assets are read when needed. Publishing does not put every file into every model turn.", "A managed run captures authorized identities, exact versions and content digests. New publications do not retarget an in-progress run, replay or retry. Active guidance is restored for later turns even when chat history is shortened.", "Subagents inherit the captured catalog and may narrow it. They cannot add Skills, change pinned bytes or gain business tools through Skill selection. Access evidence records the Skill/version/digest and resource path and byte count separately from instruction bodies and opaque Provider reasoning."],
    },
    {
      id: "execution", title: "Scripts and harness configuration",
      paragraphs: ["Scripts remain bundled resources until an independently authorized execution path runs them. Execution requires an approved installed runner image, Tenant configuration and a separate business tool grant. Skill text or a manifest declaration alone cannot grant this capability. The isolated runner has no network or inherited credentials and no host-shell fallback. Ask your platform administrator to configure and test the actual runner deployment.", "CodeAct candidate images must be rebuilt with the Skills RPC bootstrap. Resource access uses the host's captured session; business permissions still apply separately. A custom reasoning adapter must accept prepared Skill messages or fail explicitly.", "Selectable production Codex execution remains disabled pending separate Gateway and process-supervision integration; configuring a Skill library or sandbox does not enable it. Native Codex integration targets the pinned runtime and rejects ambient discovery outside supplied bundles. A private Codex home alone is not a sandbox; repository and system discovery require reviewed isolation. Invocation restrictions unsupported by the pinned native protocol fail explicitly. A discovery probe is not proof of a deployed Workflow or a successful model run."],
    },
    {
      id: "troubleshooting", title: "Troubleshoot common problems",
      paragraphs: [],
      table: { headings: ["Symptom", "Check"], rows: [
        ["Skill absent from selector", "Publish or restore it, check the Tenant and inherited scope, and load more pages."],
        ["Useful guidance not activated", "Improve its trigger description. Inspect the run's version and activation, or choose explicit start activation."],
        ["Tool or script unavailable", "Check the separate business permission and integration/runner configuration. Skill text cannot grant access."],
        ["Resource read fails", "Check its relative path, bundle inclusion and read limits. Markdown-only export excludes resources."],
        ["Saved changes did not affect a run", "Publish the Skill, check pins, and start a new run. Existing runs keep their snapshots."],
        ["Generation or comparison fails", "Inspect the error and Tenant model settings. No mock success replaces a failed real call."],
      ] },
    },
  ],
};

const zh: SkillHelpCopy = {
  title: "技能帮助与示例",
  introduction: "创建可复用的操作指引，检查验证证据，并让合适的智能体使用已发布技能。租户管理员可创建、发布和比较技能；查看者和操作员可浏览和导出。技能提供指引和资源，不授予业务工具、凭据或脚本执行权限。",
  back: "返回技能库", contents: "本页内容", workflowLink: "打开工作流",
  sections: [
    {
      id: "create", title: "创建与修订",
      paragraphs: ["说明技能的能力、适用时机、输入、预期输出和限制。提供一个应当使用技能的真实任务，以及一个相近但不应使用的任务。", "请核对创建器的假设。建议检查尚未执行，它们只是待运行的提示和判断标准，不是通过结果。模型与用量记录实际生成情况；手动编辑后，创建说明可能仍对应较早的草稿修订。"],
      steps: ["选择“描述技能”，输入用途和示例。使用租户创作模型策略，或选择可用的模型路由。", "选择“创建技能”，生成的草稿会在文件编辑器中打开。", "检查文件、假设和建议检查。编辑、校验、保存更改，准备好后再发布版本。", "修订已保存的草稿时选择“使用 AI 修订”。请先保存本地编辑，检查新草稿后再发布。也可选择“新建空白技能”，无需模型调用。"],
      example: "创建 order-exception-review 技能。检查用户提供的采购订单详情，找出缺失审批或金额冲突。输出已知事实、缺失信息和后续审核步骤。不要虚构审批阈值，也不要联系供应商。一般的订单状态问题不应触发此技能。",
    },
    {
      id: "files", title: "编写和维护文件",
      paragraphs: ["可移植技能包的根目录包含 SKILL.md，开头是含 name 和 description 的 YAML，随后是 Markdown 指引。名称使用小写字母和连字符；描述说明适用时机。主文档保持简洁，通过相对路径链接详细参考资料和模板。", "在“源文件”中编辑文本，在“预览”中打开相对资源链接。预览不执行代码、不渲染原始 HTML，也不加载远程图片。可添加文本文件、上传、重命名或移除文件。二进制文件按字节保留，可下载检查或上传替换。", "“保存更改”可以保留尚未完成的草稿。“校验”检查结构、元数据和路径，不验证任务质量。发布和 ZIP 导出要求有效的技能包；草稿无效时仍可仅导出 SKILL.md 以保留主文档。", "保存冲突会保留本地编辑。请先复制或比较，再选择“重新加载已保存草稿”；重新加载会替换编辑器内容。"],
      example: "---\nname: order-exception-review\ndescription: 检查提供的采购订单异常，适用于缺失审批或金额冲突，不适用于一般状态查询。\n---\n\n以提供的记录为依据。\n输出已知事实、缺失信息和后续步骤。\n需要详细审核时，查阅 references/checklist.md。",
    },
    {
      id: "portability", title: "导入、导出与技能库",
      paragraphs: ["“导入技能”接受 ZIP、SKILL.md 或技能文件夹。检查文件和诊断后再“加入技能库”。导入只创建草稿，不执行或发布内容。ZIP 顶层文件夹的名称须与声明的技能名称一致。", "“导出技能包”保留所有已接纳资源的字节。“仅导出 SKILL.md”不包含附属文件。导出不转移凭据、业务工具权限、评估记录或智能体配置；迁移到其他执行框架时请检查依赖。", "“当前租户”技能库仅对当前租户可见。“共享技能库”的发布版本对各租户可用，由平台超级管理员维护，未发布草稿仍仅对平台库内部可见。“复制到我的技能库”创建独立租户草稿，不会自动同步后续共享版本。"],
    },
    {
      id: "versions", title: "保存、发布与历史",
      paragraphs: ["保存创建草稿修订；“发布版本”创建带编号且不可变的版本，供新运行目录使用。仅保存草稿不会让生产运行使用它。", "“版本历史”展示发布版本和较早草稿。“恢复为草稿”创建新的可编辑修订，已有发布版本保持不变。若要成为最新版，请再次发布恢复后的内容。", "“归档技能”将其移出新运行目录，同时保留历史和已捕获的运行。“恢复到技能库”让最新发布版本再次可用。明确配置了不可用技能时，需要修正配置，系统不会静默替换。"],
    },
    {
      id: "compare", title: "比较模型响应与人工审阅",
      paragraphs: ["打开“对比技能回答”，选择已保存草稿修订或发布版本，填写真实任务和预期标准，再运行对比。建议检查可预填表单，但不会自动开始。比较记录两次真实网关调用：一次仅接收任务，另一次同时接收完整 SKILL.md 指引。请检查两份输出及各自实际使用的提供商、模型和用量；路由策略或回退可能影响选择。", "“已完成”仅表示观察结果已记录。人工应阅读两份输出，按预期标准给出通过或失败及说明，再保存人工审阅。可刷新历史查看记录，或取消待处理的比较。失败或取消的比较不能当作完成结果评分。记录绑定确切的来源修订/版本及内容摘要；即使比较共享技能，提示和输出也仅对评估租户可见。", "两组比较均不执行业务工具、脚本、外部服务或附属资源读取，也不测试自动发现、激活或完整工作流。两次响应只是有限证据，创建器建议的检查不会自动运行。集成行为需要另行授权的运行或测试实验室验证。"],
    },
    {
      id: "assign", title: "配置工作流与智能体",
      paragraphs: ["在工作流编辑器打开“工作流技能”，或在智能体工作室打开“技能”。保存定义并执行正常的校验/发布流程。测试实验室保留被测定义中的技能配置，遵守相同访问边界。", "选定技能可跟随最新发布版本或固定确切版本。最新版本在新的根运行开始时仅解析一次。工作流中的智能体继承已捕获版本，并只能缩小范围。“运行开始时加载”显式激活指引；否则由模型判断何时适用。", "切换模式会保留已保存选择，仅在选定模式下生效。缺失、归档、未发布、超出范围和固定版本不可用的条目会持续显示。请修正技能、版本或父级范围，或移除配置。加载失败不会清空选择；“加载更多”可读取后续目录页。"],
      table: { headings: ["模式", "可用范围"], rows: [
        ["继承可用技能", "默认模式。工作流继承当前租户和共享库的已发布技能；智能体继承工作流范围，独立智能体继承租户和共享库。"],
        ["使用选定技能", "仅保留继承范围内的选定技能。空选择表示没有技能。"],
        ["禁用技能", "此范围不提供技能，子智能体无法重新启用。"],
      ] },
    },
    {
      id: "runtime", title: "了解运行时加载",
      paragraphs: ["可用目录首先包含名称和描述。激活后加载完整指引，需要时再读取参考资料和资源。发布不会将所有文件加入每次模型调用。", "托管运行捕获授权身份、确切版本及内容摘要。后续发布不会改变进行中的运行、重放或重试。即使对话历史被缩短，后续轮次也会恢复已激活的指引。", "子智能体继承捕获的目录，并可进一步缩小范围。它们无法加入新技能、更换固定内容或通过选择技能取得业务工具。访问证据记录技能/版本/摘要、资源路径和字节数，与指引正文和提供商不透明推理状态分开。"],
    },
    {
      id: "execution", title: "脚本与执行框架配置",
      paragraphs: ["脚本在独立授权的执行路径运行前，仅作为包内资源保存。执行需要已安装且获批准的运行器镜像、租户配置及单独的业务工具授权。技能文本或清单声明本身无法授予能力。隔离运行器无网络、无继承凭据，也没有主机 shell 回退。请由平台管理员配置并测试实际部署。", "CodeAct 候选镜像须重建以包含技能 RPC 启动程序。资源访问使用宿主捕获的会话，业务权限另行检查。自定义推理适配器必须接受准备好的技能消息，否则明确报错。", "可选的生产 Codex 执行目前仍未启用，需另行完成网关与进程监管集成；配置技能库或沙箱不会自动启用它。原生 Codex 集成使用固定版本，并拒绝发现授权技能包以外的环境技能。私有 Codex 主目录并非沙箱，仓库和系统目录的发现仍需审查隔离。固定原生协议无法落实的调用限制会明确失败。目录发现探测并不证明已部署工作流或成功执行模型任务。"],
    },
    {
      id: "troubleshooting", title: "常见问题",
      paragraphs: [],
      table: { headings: ["现象", "检查方法"], rows: [
        ["选择器中找不到技能", "发布或恢复技能，检查租户与继承范围，并加载更多目录页。"],
        ["有用的指引未激活", "改进触发描述，检查运行版本与激活记录，或选择运行开始时显式加载。"],
        ["工具或脚本不可用", "检查独立业务权限及集成/运行器配置。技能文本不能授予访问权限。"],
        ["资源读取失败", "检查相对路径、包内文件和读取限制。仅导出 Markdown 不含附属资源。"],
        ["保存后运行仍未变化", "发布技能，检查固定版本，然后开始新运行。已有运行保留原快照。"],
        ["生成或比较失败", "查看错误和租户模型设置。系统不会用模拟成功替代失败的真实调用。"],
      ] },
    },
  ],
};

export function skillHelpCopy(language: string): SkillHelpCopy {
  return language === "zh" ? zh : en;
}
