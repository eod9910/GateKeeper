import { Router, Request, Response } from 'express';
import { transcribeAudio } from '../services/audioService';

const router = Router();

router.post('/transcribe', async (req: Request, res: Response) => {
  try {
    const audioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64.trim() : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : 'audio/webm';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : '';
    const language = typeof req.body?.language === 'string' ? req.body.language.trim() : '';

    if (!audioBase64) {
      return res.status(400).json({
        success: false,
        error: 'audioBase64 is required',
      });
    }

    const result = await transcribeAudio({
      audioBase64,
      mimeType,
      fileName,
      language,
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Transcription failed',
    });
  }
});

export default router;
