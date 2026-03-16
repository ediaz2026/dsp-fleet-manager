const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

let client = null;
function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function analyzeVehicleDamage(newPhotos, previousPhotos) {
  const ai = getClient();
  if (!ai) {
    return { status: 'skipped', notes: 'AI analysis not configured (no API key)', flagged: false };
  }

  try {
    const photoContent = [];

    // Add previous photos
    if (previousPhotos.length > 0) {
      photoContent.push({ type: 'text', text: '=== PREVIOUS INSPECTION PHOTOS ===' });
      for (const photo of previousPhotos.slice(0, 3)) {
        const filePath = path.join(__dirname, '../../', photo.file_path.replace(/^\//, ''));
        if (fs.existsSync(filePath)) {
          const imageData = fs.readFileSync(filePath).toString('base64');
          photoContent.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
          });
          photoContent.push({ type: 'text', text: `Previous: ${photo.photo_angle}` });
        }
      }
    }

    // Add new photos
    photoContent.push({ type: 'text', text: '=== NEW INSPECTION PHOTOS ===' });
    for (const photo of newPhotos.slice(0, 3)) {
      const filePath = path.join(__dirname, '../../', photo.file_path.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        const imageData = fs.readFileSync(filePath).toString('base64');
        photoContent.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageData }
        });
        photoContent.push({ type: 'text', text: `New: ${photo.photo_angle}` });
      }
    }

    if (photoContent.length <= 2) {
      return { status: 'analyzed', notes: 'No photos available for comparison', flagged: false };
    }

    const response = await ai.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          ...photoContent,
          {
            type: 'text',
            text: `You are a vehicle damage detection AI for a delivery fleet. Compare the previous and new inspection photos.

Identify any NEW damage, scratches, dents, or changes not present in previous photos.
Respond in JSON format:
{
  "damage_detected": boolean,
  "confidence": number (0-100),
  "findings": string (brief description),
  "flagged_angles": array of angle names with damage,
  "severity": "none"|"minor"|"moderate"|"severe"
}`
          }
        ]
      }]
    });

    const text = response.content[0].text;
    let result;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { damage_detected: false, confidence: 50, findings: text };
    } catch {
      result = { damage_detected: false, confidence: 50, findings: text };
    }

    return {
      status: 'analyzed',
      flagged: result.damage_detected,
      confidence: result.confidence,
      notes: result.findings,
      severity: result.severity || 'none',
      flaggedAngles: result.flagged_angles || []
    };
  } catch (err) {
    console.error('AI analysis error:', err.message);
    return { status: 'error', notes: err.message, flagged: false };
  }
}

module.exports = { analyzeVehicleDamage };
