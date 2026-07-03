/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DatasetItem, DatasetFormat, AlpacaItem, ShareGPTItem, QAItem, RawItem } from '../types';

export interface ValidationError {
  itemIndex: number;
  itemId: string;
  field: string;
  message: string;
}

export interface ValidationWarning {
  itemIndex: number;
  itemId: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  totalItems: number;
  validItems: number;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export function validateAlpacaItem(item: AlpacaItem, index: number, itemId: string): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!item.instruction || item.instruction.trim().length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'instruction', message: 'Instruction is required and cannot be empty' });
  }

  if (!item.output || item.output.trim().length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'output', message: 'Output is required and cannot be empty' });
  }

  if (item.instruction && item.instruction.length < 10) {
    warnings.push({ itemIndex: index, itemId, message: 'Instruction is very short (< 10 characters)' });
  }

  if (item.output && item.output.length < 20) {
    warnings.push({ itemIndex: index, itemId, message: 'Output is very short (< 20 characters)' });
  }

  return { errors, warnings };
}

export function validateShareGPTItem(item: ShareGPTItem, index: number, itemId: string): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!item.messages || !Array.isArray(item.messages)) {
    errors.push({ itemIndex: index, itemId, field: 'messages', message: 'Messages array is required' });
    return { errors, warnings };
  }

  if (item.messages.length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'messages', message: 'Messages array cannot be empty' });
    return { errors, warnings };
  }

  item.messages.forEach((msg, msgIdx) => {
    if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
      errors.push({ itemIndex: index, itemId, field: `messages[${msgIdx}].role`, message: 'Invalid role, must be system/user/assistant' });
    }
    if (!msg.content || msg.content.trim().length === 0) {
      errors.push({ itemIndex: index, itemId, field: `messages[${msgIdx}].content`, message: 'Message content cannot be empty' });
    }
  });

  const hasUserMessage = item.messages.some(m => m.role === 'user');
  const hasAssistantMessage = item.messages.some(m => m.role === 'assistant');
  
  if (!hasUserMessage) {
    warnings.push({ itemIndex: index, itemId, message: 'No user message found' });
  }
  if (!hasAssistantMessage) {
    warnings.push({ itemIndex: index, itemId, message: 'No assistant message found' });
  }

  return { errors, warnings };
}

export function validateQAItem(item: QAItem, index: number, itemId: string): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!item.question || item.question.trim().length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'question', message: 'Question is required and cannot be empty' });
  }

  if (!item.answer || item.answer.trim().length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'answer', message: 'Answer is required and cannot be empty' });
  }

  if (item.question && item.question.length < 10) {
    warnings.push({ itemIndex: index, itemId, message: 'Question is very short (< 10 characters)' });
  }

  if (item.answer && item.answer.length < 20) {
    warnings.push({ itemIndex: index, itemId, message: 'Answer is very short (< 20 characters)' });
  }

  return { errors, warnings };
}

export function validateRawItem(item: RawItem, index: number, itemId: string): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!item.title || item.title.trim().length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'title', message: 'Title is required and cannot be empty' });
  }

  if (!item.text || item.text.trim().length === 0) {
    errors.push({ itemIndex: index, itemId, field: 'text', message: 'Text is required and cannot be empty' });
  }

  if (item.text && item.text.length < 100) {
    warnings.push({ itemIndex: index, itemId, message: 'Text is very short (< 100 characters)' });
  }

  return { errors, warnings };
}

export function validateDatasetItem(item: DatasetItem, index: number): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!item.id) {
    errors.push({ itemIndex: index, itemId: 'unknown', field: 'id', message: 'Item ID is required' });
  }

  if (!item.format || !['alpaca', 'sharegpt', 'qa', 'raw'].includes(item.format)) {
    errors.push({ itemIndex: index, itemId: item.id || 'unknown', field: 'format', message: 'Invalid format, must be alpaca/sharegpt/qa/raw' });
    return { errors, warnings };
  }

  if (!item.metadata) {
    errors.push({ itemIndex: index, itemId: item.id || 'unknown', field: 'metadata', message: 'Metadata is required' });
  } else {
    if (!item.metadata.reasoning || item.metadata.reasoning.trim().length === 0) {
      warnings.push({ itemIndex: index, itemId: item.id || 'unknown', message: 'Reasoning is empty or missing' });
    }
    if (!item.metadata.intent) {
      warnings.push({ itemIndex: index, itemId: item.id || 'unknown', message: 'Intent is not specified' });
    }
    if (!item.metadata.complexity || !['novice', 'intermediate', 'expert'].includes(item.metadata.complexity)) {
      errors.push({ itemIndex: index, itemId: item.id || 'unknown', field: 'metadata.complexity', message: 'Invalid complexity level' });
    }
    if (typeof item.metadata.is_negative !== 'boolean') {
      errors.push({ itemIndex: index, itemId: item.id || 'unknown', field: 'metadata.is_negative', message: 'is_negative must be a boolean' });
    }
  }

  const formatValidators = {
    alpaca: validateAlpacaItem,
    sharegpt: validateShareGPTItem,
    qa: validateQAItem,
    raw: validateRawItem
  };

  const validator = formatValidators[item.format];
  const formatData = item[item.format];
  
  if (!formatData) {
    errors.push({ itemIndex: index, itemId: item.id || 'unknown', field: item.format, message: `${item.format} data is missing` });
  } else {
    const result = validator(formatData as any, index, item.id || 'unknown');
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return { errors, warnings };
}

export function validateDataset(items: DatasetItem[], format?: DatasetFormat): ValidationResult {
  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];

  items.forEach((item, index) => {
    if (format && item.format !== format) {
      allErrors.push({
        itemIndex: index,
        itemId: item.id || 'unknown',
        field: 'format',
        message: `Expected format ${format}, got ${item.format}`
      });
      return;
    }

    const result = validateDatasetItem(item, index);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  });

  const errorItemIndices = new Set(allErrors.map(e => e.itemIndex));
  const validItems = items.length - errorItemIndices.size;

  return {
    valid: allErrors.length === 0,
    totalItems: items.length,
    validItems,
    errors: allErrors,
    warnings: allWarnings
  };
}