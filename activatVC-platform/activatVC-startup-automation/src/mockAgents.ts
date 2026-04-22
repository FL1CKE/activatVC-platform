import { AgentConfig, MockAgentResponse, normalizeStage } from './constants';

type AgentPayload = {
  round: number;
  submission: {
    startupName: string;
    startupStage?: string | null;
    description?: string | null;
    businessModel?: string | null;
    financialSummary?: string | null;
    founders?: unknown;
  };
  documentIndex: Array<{ category?: string }>;
  relevantDocuments: Array<{ category: string }>;
  gapReviewResponses?: Array<{ title: string; responseText?: string | null }>;
};

export function buildMockAgentResponse(agent: AgentConfig, payload: AgentPayload): MockAgentResponse {
  const stage = normalizeStage(payload.submission.startupStage);
  const categories = new Set(payload.relevantDocuments.map((doc) => doc.category));
  const allDocumentCategories = new Set(payload.documentIndex.map((doc) => doc.category || 'general'));
  const founders = Array.isArray(payload.submission.founders) ? payload.submission.founders : [];
  const gapReviewResponses = payload.gapReviewResponses || [];
  const hasBusinessResponse = gapReviewResponses.some((response) => response.title === 'Missing business overview' && response.responseText);
  const hasFinancialResponse = gapReviewResponses.some((response) => response.title === 'Missing financial information' && response.responseText);
  const hasFounderResponse = gapReviewResponses.some((response) => response.title === 'Missing founder background' && response.responseText);

  const hasBusiness = Boolean(payload.submission.description || payload.submission.businessModel || allDocumentCategories.has('business') || allDocumentCategories.has('general') || hasBusinessResponse);
  const hasFinancial = Boolean(payload.submission.financialSummary || allDocumentCategories.has('financial') || hasFinancialResponse);
  const hasTeam = founders.length > 0 || allDocumentCategories.has('team') || hasFounderResponse;
  const hasTechnical = allDocumentCategories.has('technical');
  const hasLegal = allDocumentCategories.has('legal');

  let score = 7.2;
  const requestedDocuments = [] as MockAgentResponse['requestedDocuments'];
  const strengths: string[] = [];
  const risks: string[] = [];

  if (agent.name === 'CFO') {
    score = hasFinancial ? 7.8 : 5.3;
    strengths.push(hasFinancial ? 'Financial story is present and reviewable.' : 'The fundraising ask is at least visible in the submission.');
    risks.push(hasFinancial ? 'Financial assumptions still need investor validation.' : 'Financial visibility is weak without model or summary.');
    if (!hasFinancial) {
      requestedDocuments.push({
        title: 'Financial model or summary',
        description: 'CFO needs a clearer view of revenue logic, costs, and runway.',
        question: 'Please upload a financial model, P&L, or answer with current revenue, costs, and runway.',
        inputType: 'text_or_file',
        severity: 'critical',
      });
    }
  } else if (agent.name === 'CLO') {
    score = hasLegal ? 7.0 : 6.1;
    strengths.push(hasLegal ? 'Legal materials are available for initial diligence.' : 'No hard legal blocker is visible in the current intake.');
    risks.push(hasLegal ? 'Corporate structure still needs deeper confirmation.' : 'Corporate and ownership documents are missing.');
    if (!hasLegal) {
      requestedDocuments.push({
        title: 'Legal and corporate documents',
        description: 'CLO needs visibility into incorporation, ownership, and agreements.',
        question: 'Please upload incorporation docs, cap table, SAFE, SHA, or equivalent legal materials.',
        inputType: 'file',
        severity: 'recommended',
      });
    }
  } else if (agent.name === 'CMO+CCO') {
    score = hasBusiness ? 7.6 : 5.8;
    strengths.push(hasBusiness ? 'Go-to-market narrative exists in the current package.' : 'The startup concept is visible, but the market story is thin.');
    risks.push(hasBusiness ? 'Commercial traction may still need interview validation.' : 'Positioning and customer narrative are not documented well enough.');
    if (!hasBusiness) {
      requestedDocuments.push({
        title: 'Pitch deck or market overview',
        description: 'CMO+CCO needs clearer market, ICP, and GTM context.',
        question: 'Please upload a pitch deck or share a short market and GTM overview.',
        inputType: 'text_or_file',
        severity: 'critical',
      });
    }
  } else if (agent.name === 'CPO+CTO') {
    score = hasTechnical ? 7.4 : 6.0;
    strengths.push(hasTechnical ? 'Technical context is available for product review.' : 'The product can still be reviewed from high-level materials.');
    risks.push(hasTechnical ? 'Execution feasibility still needs deeper diligence.' : 'Architecture and product execution details are not yet documented.');
    if (!hasTechnical) {
      requestedDocuments.push({
        title: 'Technical roadmap or architecture',
        description: 'CPO+CTO needs a view of product maturity and technical plan.',
        question: 'Please upload roadmap, architecture notes, specs, or product screenshots.',
        inputType: 'file',
        severity: 'recommended',
      });
    }
  } else if (agent.name === 'CHRO') {
    score = hasTeam ? 8.0 : 5.9;
    strengths.push(hasTeam ? 'Founder/team context is available for leadership review.' : 'The submission still indicates founder intent and stage.');
    risks.push(hasTeam ? 'Leadership depth still needs interview validation.' : 'Leadership history is unclear without team profiles.');
    if (!hasTeam) {
      requestedDocuments.push({
        title: 'Founder CV or profiles',
        description: 'CHRO needs better visibility into founder backgrounds.',
        question: 'Please upload founder CVs or provide LinkedIn / team profile links.',
        inputType: 'text_or_file',
        severity: 'critical',
      });
    }
  } else {
    score = hasBusiness && hasFinancial && hasTeam ? 7.1 : 6.0;
    strengths.push(`${agent.name} gets a broad package view across the submission.`);
    risks.push('Risk assessment quality depends on the completeness of the uploaded package.');
  }

  if (stage === 'pre-seed') {
    score = Math.min(8.8, score + 0.2);
  }

  const partial = requestedDocuments.length > 0 || categories.size === 0;

  return {
    specialist: agent.name,
    round: payload.round,
    score: Number(score.toFixed(1)),
    summary: `${agent.name} mock review completed for ${payload.submission.startupName}.`,
    strengths,
    risks,
    criteriaBreakdown: [
      {
        name: 'Readiness',
        score: Number((score - 0.3).toFixed(1)),
        note: partial ? 'Assessment is provisional because additional materials would help.' : 'The current package is sufficient for a mock v1 review.',
      },
      {
        name: 'Documentation quality',
        score: Number((partial ? score - 1.0 : score).toFixed(1)),
        note: partial ? 'Some requested materials are still missing.' : 'Documentation is coherent for this stage.',
      },
    ],
    participationConditions: {
      label: score >= 7.5 ? 'Promising' : 'Needs work',
      details: partial
        ? ['Close the requested documentation gaps before final diligence.', 'Keep the investor narrative aligned with the uploaded materials.']
        : ['Keep the DataRoom organized for investor review.', 'Prepare founder interview follow-ups.'],
    },
    founderRecommendations: {
      label: 'Next steps',
      details: partial
        ? ['Upload the requested materials through the founder portal.', 'Clarify the strongest investor-ready narrative in the submission.']
        : ['Keep key metrics and documents updated.', 'Use the current package as the base investor briefing set.'],
    },
    questionsForFounderInterview: [
      {
        question: `What is the strongest proof point behind ${payload.submission.startupName}'s current momentum?`,
        priority: 'high',
        why: 'Helps validate the quality of the current fundraising narrative.',
      },
      {
        question: 'Which milestones do you expect to unlock with this round?',
        priority: 'medium',
        why: 'Clarifies execution planning after fundraising.',
      },
    ],
    dataQuality: {
      status: partial ? 'partial' : 'complete',
      notes: partial ? ['Some recommended or critical materials are still missing.'] : ['Current package is sufficient for the mock workflow.'],
    },
    crossQueries: [],
    requestedDocuments,
  };
}

