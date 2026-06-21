import { RequestHandler } from 'express';
import {
  analyzeChartPattern,
  chatWithCopilot,
  checkOllamaStatus,
  listWorkspaceAnalysts,
  type TradingContext,
  type VisionAnalysis,
} from '../../services/visionService';
import { ApiResponse } from '../../types';

type VisionPatternInfo = Parameters<typeof analyzeChartPattern>[1];
type VisionAnalysisMode = Parameters<typeof analyzeChartPattern>[2];

export interface VisionChatLogDetails {
  analyst: string;
  hasChartImage: boolean;
  chartImageLength: number;
  aiModel: string | null;
  pluginEngineerModel: string | null;
  symbol: string | null;
  messageLength: number;
}

export interface VisionRouteServices {
  checkOllamaStatus: typeof checkOllamaStatus;
  listWorkspaceAnalysts: typeof listWorkspaceAnalysts;
  analyzeChartPattern: typeof analyzeChartPattern;
  chatWithCopilot: typeof chatWithCopilot;
  logChatRequest: (details: VisionChatLogDetails) => void;
}

export interface VisionRouteHandlers {
  status: RequestHandler;
  analysts: RequestHandler;
  analyze: RequestHandler;
  chat: RequestHandler;
}

export function createVisionRouteServices(): VisionRouteServices {
  return {
    checkOllamaStatus,
    listWorkspaceAnalysts,
    analyzeChartPattern,
    chatWithCopilot,
    logChatRequest: (details) => {
      console.log('[VisionRoute] /api/vision/chat', JSON.stringify(details));
    },
  };
}

export function createVisionRouteHandlers(services: VisionRouteServices): VisionRouteHandlers {
  return {
    status: async (_req, res) => {
      try {
        const status = await services.checkOllamaStatus();

        res.json({
          success: true,
          data: status,
        } as ApiResponse<typeof status>);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        } as ApiResponse<null>);
      }
    },

    analysts: async (_req, res) => {
      try {
        res.json({
          success: true,
          data: services.listWorkspaceAnalysts(),
        } as ApiResponse<ReturnType<typeof listWorkspaceAnalysts>>);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        } as ApiResponse<null>);
      }
    },

    analyze: async (req, res) => {
      try {
        const { imageBase64, patternInfo, analysisMode } = req.body as {
          imageBase64?: unknown;
          patternInfo?: VisionPatternInfo;
          analysisMode?: VisionAnalysisMode;
        };
        const normalizedImage = typeof imageBase64 === 'string' ? imageBase64.trim() : '';

        if (!normalizedImage) {
          return res.status(400).json({
            success: false,
            error: 'imageBase64 is required',
          } as ApiResponse<null>);
        }

        const analysis = await services.analyzeChartPattern(normalizedImage, patternInfo, analysisMode);

        res.json({
          success: true,
          data: analysis,
        } as ApiResponse<VisionAnalysis>);
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        } as ApiResponse<null>);
      }
    },

    chat: async (req, res) => {
      try {
        const { message, context, chartImage, role, analyst, aiModel, pluginEngineerModel } = req.body as {
          message?: unknown;
          context?: TradingContext;
          chartImage?: unknown;
          role?: string;
          analyst?: string;
          aiModel?: string;
          pluginEngineerModel?: string;
        };

        services.logChatRequest({
          analyst: analyst || role || 'copilot',
          hasChartImage: !!chartImage,
          chartImageLength: typeof chartImage === 'string' ? chartImage.length : 0,
          aiModel: aiModel || null,
          pluginEngineerModel: pluginEngineerModel || null,
          symbol: context?.symbol || context?.copilotAnalysis?.candidate?.symbol || null,
          messageLength: typeof message === 'string' ? message.length : 0,
        });

        if (!message) {
          return res.status(400).json({
            success: false,
            error: 'message is required',
          } as ApiResponse<null>);
        }

        const response = await services.chatWithCopilot(
          message as string,
          context as TradingContext,
          chartImage as string | undefined,
          analyst || role,
          aiModel,
          pluginEngineerModel
        );

        res.json({
          success: true,
          data: { response },
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        } as ApiResponse<null>);
      }
    },
  };
}
