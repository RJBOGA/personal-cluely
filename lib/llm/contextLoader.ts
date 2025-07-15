// lib/llm/contextLoader.ts
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';

export async function loadResumeText() {
  const resumePath = path.join(__dirname, '../../context/rjboga.docx');
  if (fs.existsSync(resumePath)) {
    const result = await mammoth.extractRawText({ path: resumePath });
    return result.value;
  }
  return '';
}