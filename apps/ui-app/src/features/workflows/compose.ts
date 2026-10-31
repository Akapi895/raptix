import { defaultConfig, type AiOptions, type AiResult, type GraphEdge, type GraphNode, type ToolOption, type Translate } from './model';

const hints = [
  { keywords: ['\u5b50\u57df\u540d', 'subdomain', 'subfinder', 'amass'], tools: ['subfinder', 'amass'], label: 'Subdomain discovery' },
  { keywords: ['\u7aef\u53e3', 'port', 'nmap', 'rustscan', 'masscan'], tools: ['nmap', 'rustscan', 'masscan'], label: 'Port scanning' },
  { keywords: ['\u6f0f\u6d1e', 'vuln', 'nuclei', 'nikto', 'zap'], tools: ['nuclei', 'nikto', 'zap'], label: 'Vulnerability scanning' },
  { keywords: ['\u76ee\u5f55', '\u8def\u5f84', '\u66b4\u9732\u9875\u9762', 'dir', 'ffuf', 'gobuster', 'feroxbuster'], tools: ['ffuf', 'gobuster', 'feroxbuster', 'dirsearch'], label: 'Exposed surface probing' },
  { keywords: ['\u8bc1\u4e66', 'certificate', 'crt'], tools: ['subfinder'], label: 'Certificate and domain intel' },
  { keywords: ['\u4e91', 'cloud', '\u914d\u7f6e\u5ba1\u8ba1', 'prowler', 'scout'], tools: ['prowler', 'scout-suite'], label: 'Cloud configuration audit' },
  { keywords: ['\u5bb9\u5668', '\u955c\u50cf', 'k8s', 'kubernetes', 'trivy', 'kube'], tools: ['trivy', 'kube-bench', 'kube-hunter'], label: 'Container security checks' },
  { keywords: ['\u60c5\u62a5', '\u5a01\u80c1\u60c5\u62a5', 'threat', 'ioc', 'virustotal', 'shodan', 'fofa'], tools: ['virustotal_search', 'shodan_search', 'fofa_search'], label: 'Threat intelligence collection' },
];
export function composeDraft(prompt: string, options: AiOptions, tools: ToolOption[], t: Translate): AiResult {
  const enabled = tools.filter(tool => tool.enabled), available = enabled.length ? enabled : tools;
  const capabilities = hints.filter(hint => hint.keywords.some(key => prompt.toLowerCase().includes(key))).map(hint => ({ label: hint.label, tool_name: hint.tools.map(name => available.find(tool => tool.key.toLowerCase().includes(name))?.key).find(Boolean) ?? '', tool_candidates: hint.tools }));
  if (!capabilities.length) capabilities.push({ label: t('workflows.ai.resultCapabilities'), tool_name: '', tool_candidates: [] });
  const highRisk = /(\u9694\u79bb|\u5c01\u7981|\u52a0\u56fa|\u4fee\u590d|\u6267\u884c|\u547d\u4ee4|\u811a\u672c|\u5220\u9664|\u6e05\u7406|\u963b\u65ad|\u5c01\u9501|\u653b\u51fb|\u5229\u7528|getshell|shell|payload|exploit|isolate|block|execute|script|delete)/i.test(prompt);
  const approval = /(\u5ba1\u6279|\u786e\u8ba4|\u5ba1\u6838|\u8d1f\u8d23\u4eba|\u4eba\u5de5|review|approve|approval|human)/i.test(prompt);
  const condition = /(\u5982\u679c|\u53d1\u73b0|\u5b58\u5728|\u9ad8\u5371|\u65b0\u589e|\u5931\u8d25|\u901a\u8fc7|\u5426\u5219|if|when|high|critical|new|fail)/i.test(prompt);
  const report = /(\u62a5\u544a|\u6c47\u603b|\u8f93\u51fa|\u901a\u77e5|\u4efb\u52a1|\u5de5\u5355|report|summary|notify|ticket)/i.test(prompt);
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], assumptions: string[] = [], warnings: string[] = [];
  let x = 120, openCondition = '';
  const add = (type: string, label: string, config: Record<string, unknown> = {}, y = 150) => {
    const id = `${type}-${nodes.length + 1}`; nodes.push({ id, type, label, position: { x, y }, config: { ...defaultConfig(type, t), ...config, generated_by: 'natural_language', needs_review: 'true' } }); x += 210; return id;
  };
  const connect = (source: string, target: string, branch = '') => edges.push({ id: 'edge-ai-' + (edges.length + 1), source, target, label: branch ? t('workflows.edges.' + (branch === 'true' ? 'yes' : 'no')) : '', config: branch ? { condition: `{{previous.matched}} == "${branch}"`, branch } : {} });
  let previous = add('start', t('workflows.nodes.start'), { input_keys: 'message, conversationId, projectId, target' });
  for (const capability of capabilities) {
    const id = add(capability.tool_name ? 'tool' : 'agent', capability.label, capability.tool_name ? { tool_name: capability.tool_name, arguments: '{"target":"{{inputs.target}}","message":"{{inputs.message}}"}', timeout_seconds: '120' } : { instruction: capability.label + '. Execute the security workflow step per the user request and output structured results: ' + prompt, missing_tool_candidates: capability.tool_candidates.join(', ') });
    connect(previous, id); previous = id;
    if (!capability.tool_name && capability.tool_candidates.length) assumptions.push(capability.label + ': no enabled tool matched; an Agent draft node was generated.');
  }
  if (condition) {
    const id = add('condition', highRisk ? 'High-risk handling required' : 'Trigger condition met', { expression: highRisk ? '{{previous.output}} contains "\u9ad8\u5371"' : '{{previous.output}} != ""' });
    connect(previous, id); openCondition = id; previous = id;
    const output = add('output', report ? 'Output report' : t('workflows.nodes.output'), {}, 280); connect(id, output, 'false');
  }
  if (highRisk) {
    const needsApproval = !options.allowHighRisk || approval;
    if (needsApproval) { const id = add('hitl', 'Manual approval', { prompt: 'Please confirm whether to allow the high-risk handling to proceed: ' + prompt, risk_level: 'high' }); connect(previous, id, previous === openCondition ? 'true' : ''); previous = id; openCondition = ''; }
    const id = add('agent', 'Execute controlled handling', { instruction: 'Only generate remediation drafts within the authorized scope; a human must confirm before actual execution. User request: ' + prompt, output_key: 'remediation_plan', risk_level: 'high', requires_human_confirmation: 'true' });
    connect(previous, id, previous === openCondition ? 'true' : ''); previous = id; openCondition = '';
    warnings.push(needsApproval ? 'High-risk action detected; added manual confirmation and the requires_human_confirmation flag.' : 'High-risk action detected; kept as a draft with the requires_human_confirmation flag.');
  } else if (approval) { const id = add('hitl', 'Manual approval', { prompt: 'Please review the workflow stage result: ' + prompt }); connect(previous, id, previous === openCondition ? 'true' : ''); previous = id; openCondition = ''; }
  const output = add('output', report ? 'Output report' : t('workflows.nodes.output')); connect(previous, output, previous === openCondition ? 'true' : '');
  const ascii = prompt.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  let hash = 0; for (const char of prompt) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  const config: Record<string, unknown> = { schema_version: 1, generated_by: 'natural_language', source_prompt: prompt, objective: options.includeObjective ? prompt : '' };
  if (options.allowSchedule && /(\u6bcf\u5929|\u6bcf\u5468|\u5b9a\u65f6|\u5468\u671f|\u6301\u7eed|daily|weekly|schedule|monitor)/i.test(prompt)) { config.trigger_suggestion = /(\u6bcf\u5929|daily)/i.test(prompt) ? 'daily' : 'scheduled'; assumptions.push('Schedule trigger suggestion recorded; configure it in the trigger or role binding after saving.'); }
  return { graph: { nodes, edges, config }, meta: { id: ascii || 'ai-workflow-' + Math.abs(hash || Date.now()).toString(36), name: prompt.length > 22 ? prompt.slice(0, 22) + '...' : prompt, description: prompt }, generator: 'deterministic-fallback', audit: { risk_warnings: warnings, assumptions, missing_fields: [], high_risk: highRisk, needs_hitl: nodes.some(node => node.type === 'hitl') }, assumptions, riskWarnings: warnings, capabilities, stats: { nodes: nodes.length, edges: edges.length } };
}
