/**
 * Public surface of the library feature (ADR-0096). Callers import from here; the feature's files stay private.
 * The mock store and the real adapter are wired by the composition roots, so they are not exported here.
 */
export { libraryRoutes } from './views/library-pages'
export { LibraryReadError, useLibraryCorpus, useLibraryProposal, useLibraryProposals, useLibraryWrites, useSkillDetail, useTechniqueDetail } from './query'
export type { LibraryCorpusQuery, LibraryCorpusRead, LibraryProposal, LibraryProposalExport, LibraryProposalReview, LibraryProposalStatus, LibraryProposalsRead, LibrarySkill, LibrarySkillDetail, LibraryService, LibraryTechniqueRead } from './service'
