/**
 * Artifact Servlet -- REST API for git-backed artifact management.
 *
 * Provides endpoints for:
 *   - Exporting channels to git (decompose, write, commit)
 *   - Importing channels from git (read, assemble, resolve env vars)
 *   - Diffing live channels against git versions
 *   - Sensitive field detection
 *   - Dependency graph analysis
 *   - Git operations (status, push, pull, log)
 *   - Environment promotion pipeline
 *   - Delta deploy (changed-only deployment)
 *
 * Endpoints:
 *   POST /api/artifacts/export            -- Export all channels to git
 *   GET  /api/artifacts/export/:channelId -- Export single channel (preview)
 *   POST /api/artifacts/import            -- Import channels from git
 *   GET  /api/artifacts/diff/:channelId   -- Diff channel vs git
 *   GET  /api/artifacts/sensitive/:channelId -- Detect secrets
 *   GET  /api/artifacts/deps              -- Dependency graph
 *   GET  /api/artifacts/git/status        -- Git repo status
 *   POST /api/artifacts/git/push          -- Commit + push
 *   POST /api/artifacts/git/pull          -- Pull + import
 *   GET  /api/artifacts/git/log           -- Recent commits
 *   POST /api/artifacts/promote           -- Promote to environment
 *   GET  /api/artifacts/promote/status    -- Promotion approvals
 *   GET  /api/artifacts/delta             -- Detect changed artifacts
 *   POST /api/artifacts/deploy            -- Deploy artifacts (delta or full)
 */

import { Router, Request, Response } from 'express';
import { ArtifactController } from '../../artifact/ArtifactController.js';

export const artifactRouter = Router();

// --- Middleware: ensure initialized ------------------------------------------

function checkInitialized(_req: Request, res: Response): boolean {
  if (!ArtifactController.isInitialized()) {
    res.status(503).json({
      error: 'Artifact System Not Initialized',
      message: 'The artifact controller has not been initialized. Configure MIRTH_ARTIFACT_REPO_PATH or call POST /api/artifacts/git/init.',
    });
    return false;
  }
  return true;
}

// --- Export Endpoints --------------------------------------------------------

/**
 * POST /api/artifacts/export
 * Export channels to git repo.
 * Body: { channelXmls?: Record<string, string>, maskSecrets?: boolean, push?: boolean, message?: string }
 */
artifactRouter.post('/export', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const { channelXmls, maskSecrets, push, message } = req.body || {};

    if (!channelXmls || typeof channelXmls !== 'object') {
      res.status(400).json({
        error: 'Invalid Request',
        message: 'Body must include channelXmls: Record<channelId, channelXml>',
      });
      return;
    }

    const xmlMap = new Map<string, string>(Object.entries(channelXmls));
    const result = await ArtifactController.exportAll(xmlMap, {
      maskSecrets: maskSecrets !== false,
      push: push === true,
      message,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Export Failed',
      message: String(error),
    });
  }
});

/**
 * GET /api/artifacts/export/:channelId
 * Preview export of a single channel (returns file tree without committing).
 * Query: ?xml=<channelXml>&maskSecrets=true
 */
artifactRouter.get('/export/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const channelXml = req.query.xml as string | undefined;

    if (!channelXml) {
      res.status(400).json({
        error: 'Missing Channel XML',
        message: 'Provide channel XML as ?xml= query parameter',
      });
      return;
    }

    const maskSecrets = req.query.maskSecrets !== 'false';
    const files = await ArtifactController.exportChannel(channelId, channelXml, { maskSecrets });

    res.json({ channelId, files });
  } catch (error) {
    res.status(500).json({
      error: 'Export Preview Failed',
      message: String(error),
    });
  }
});

// --- Import Endpoints -------------------------------------------------------

/**
 * POST /api/artifacts/import
 * Import channels from git repo.
 * Body: { channels?: string[], environment?: string, all?: boolean }
 */
artifactRouter.post('/import', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const { channels, environment, all } = req.body || {};

    if (all || !channels || !Array.isArray(channels) || channels.length === 0) {
      const results = await ArtifactController.importAll({ environment });
      res.json({ channels: results });
      return;
    }

    const results: Array<{ name: string; xml: string; warnings: string[] }> = [];
    for (const channelName of channels) {
      try {
        const result = await ArtifactController.importChannel(channelName, { environment });
        results.push({ name: channelName, ...result });
      } catch (err) {
        results.push({ name: channelName, xml: '', warnings: [String(err)] });
      }
    }

    res.json({ channels: results });
  } catch (error) {
    res.status(500).json({
      error: 'Import Failed',
      message: String(error),
    });
  }
});

// --- Diff / Analysis --------------------------------------------------------

/**
 * GET /api/artifacts/diff/:channelId
 * Diff a channel against the git version.
 * Query: ?xml=<channelXml>
 */
artifactRouter.get('/diff/:channelId', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const channelId = req.params.channelId as string;
    const channelXml = req.query.xml as string | undefined;

    if (!channelXml) {
      res.status(400).json({
        error: 'Missing Channel XML',
        message: 'Provide channel XML as ?xml= query parameter',
      });
      return;
    }

    const diff = await ArtifactController.diffChannel(channelId, channelXml);
    res.json(diff);
  } catch (error) {
    res.status(500).json({
      error: 'Diff Failed',
      message: String(error),
    });
  }
});

/**
 * GET /api/artifacts/sensitive/:channelId
 * Detect sensitive fields in channel XML.
 * Query: ?xml=<channelXml>
 */
artifactRouter.get('/sensitive/:channelId', async (req: Request, res: Response) => {
  try {
    const channelXml = req.query.xml as string | undefined;

    if (!channelXml) {
      res.status(400).json({
        error: 'Missing Channel XML',
        message: 'Provide channel XML as ?xml= query parameter',
      });
      return;
    }

    const fields = await ArtifactController.detectSecrets(channelXml);
    res.json({ fields });
  } catch (error) {
    res.status(500).json({
      error: 'Secret Detection Failed',
      message: String(error),
    });
  }
});

/**
 * GET /api/artifacts/deps
 * Get dependency graph for all channels.
 */
artifactRouter.get('/deps', async (_req: Request, res: Response) => {
  try {
    const graph = await ArtifactController.getDependencyGraph();
    res.json(graph);
  } catch (error) {
    res.status(500).json({
      error: 'Dependency Graph Failed',
      message: String(error),
    });
  }
});

// --- Git Operations ---------------------------------------------------------

/**
 * GET /api/artifacts/git/status
 * Git repo status (branch, staged, unstaged, untracked).
 */
artifactRouter.get('/git/status', async (_req: Request, res: Response) => {
  if (!checkInitialized(_req, res)) return;

  try {
    const status = await ArtifactController.getGitStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Git Status Failed',
      message: String(error),
    });
  }
});

/**
 * POST /api/artifacts/git/push
 * Stage, commit, and push to remote.
 * Body: { message?: string }
 */
artifactRouter.post('/git/push', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const { message } = req.body || {};
    const result = await ArtifactController.pushToGit({ message });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Git Push Failed',
      message: String(error),
    });
  }
});

/**
 * POST /api/artifacts/git/pull
 * Pull from remote and optionally import channels.
 * Body: { environment?: string, deploy?: boolean }
 */
artifactRouter.post('/git/pull', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const { environment, deploy } = req.body || {};
    const result = await ArtifactController.pullFromGit({ environment, deploy });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Git Pull Failed',
      message: String(error),
    });
  }
});

/**
 * GET /api/artifacts/git/log
 * Recent git history.
 * Query: ?limit=20
 */
artifactRouter.get('/git/log', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const log = await ArtifactController.getGitLog(limit);
    res.json({ entries: log });
  } catch (error) {
    res.status(500).json({
      error: 'Git Log Failed',
      message: String(error),
    });
  }
});

// --- Promotion --------------------------------------------------------------

/**
 * POST /api/artifacts/promote
 * Promote channels between environments.
 * Body: { sourceEnv, targetEnv, channelIds?, approvedBy?, force?, dryRun? }
 */
artifactRouter.post('/promote', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const { sourceEnv, targetEnv, channelIds, approvedBy, force, dryRun } = req.body || {};

    if (!sourceEnv || !targetEnv) {
      res.status(400).json({
        error: 'Missing Parameters',
        message: 'sourceEnv and targetEnv are required',
      });
      return;
    }

    const result = await ArtifactController.promote({
      sourceEnv,
      targetEnv,
      channelIds,
      approvedBy,
      force: force === true,
      dryRun: dryRun === true,
    });

    const status = result.success ? 200 : 400;
    res.status(status).json(result);
  } catch (error) {
    res.status(500).json({
      error: 'Promotion Failed',
      message: String(error),
    });
  }
});

/**
 * GET /api/artifacts/promote/status
 * Get promotion approval records.
 */
artifactRouter.get('/promote/status', async (_req: Request, res: Response) => {
  try {
    const status = await ArtifactController.getPromotionStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Promotion Status Failed',
      message: String(error),
    });
  }
});

// --- Delta Deploy -----------------------------------------------------------

/**
 * GET /api/artifacts/delta
 * Detect changed artifacts between git refs.
 * Query: ?from=HEAD~1&to=HEAD
 */
artifactRouter.get('/delta', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const fromRef = req.query.from as string | undefined;
    const toRef = req.query.to as string | undefined;
    const delta = await ArtifactController.detectDelta(fromRef, toRef);
    res.json(delta);
  } catch (error) {
    res.status(500).json({
      error: 'Delta Detection Failed',
      message: String(error),
    });
  }
});

/**
 * POST /api/artifacts/deploy
 * Deploy artifacts (full or delta).
 * Body: { delta?: boolean, fromRef?: string, channels?: string[] }
 */
artifactRouter.post('/deploy', async (req: Request, res: Response) => {
  if (!checkInitialized(req, res)) return;

  try {
    const { delta, fromRef, channels } = req.body || {};

    if (delta) {
      const result = await ArtifactController.deployDelta({ fromRef, channels });
      res.json(result);
    } else {
      // Full deploy — import all and return channel list
      const imported = await ArtifactController.importAll();
      res.json({
        deployed: imported.filter(c => c.xml).map(c => c.name),
        errors: imported
          .filter(c => !c.xml && c.warnings.length > 0)
          .map(c => ({ channel: c.name, error: c.warnings.join('; ') })),
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Deploy Failed',
      message: String(error),
    });
  }
});
