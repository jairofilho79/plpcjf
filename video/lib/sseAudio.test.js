import { test, describe } from 'node:test';
import assert from 'node:assert';
import { extrairAudioSSE } from './sseAudio.mjs';

describe('extrairAudioSSE', () => {
  test('junta os pedaços de base64 na ordem em que chegam', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"data":"AAA="}}}]}',
      'data: {"choices":[{"delta":{"audio":{"data":"BBB="}}}]}',
      'data: [DONE]'
    ].join('\n');
    const r = extrairAudioSSE(sse);
    assert.deepEqual(r.pcmBase64, ['AAA=', 'BBB=']);
    assert.equal(r.erro, null);
  });

  test('acumula a transcrição, que é como sabemos se o modelo improvisou', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"transcript":"Toque em "}}}]}',
      'data: {"choices":[{"delta":{"audio":{"transcript":"Filtros."}}}]}',
      'data: [DONE]'
    ].join('\n');
    assert.equal(extrairAudioSSE(sse).transcricao, 'Toque em Filtros.');
  });

  test('linhas que não são delta de áudio não poluem o resultado', () => {
    const sse = [
      ': comentário de keep-alive',
      'data: {"usage":{"cost":0.0008}}',
      'data: {"choices":[{"delta":{"content":"texto"}}]}',
      'data: {"choices":[{"delta":{"audio":{"data":"CCC="}}}]}',
      'data: [DONE]'
    ].join('\n');
    const r = extrairAudioSSE(sse);
    assert.deepEqual(r.pcmBase64, ['CCC=']);
    assert.equal(r.transcricao, '');
  });

  test('erro dentro do fluxo é devolvido, não engolido', () => {
    // O OpenRouter responde 200 e põe a falha no corpo. Tratar isto como
    // "sem áudio" produziria um wav de zero byte e um vídeo mudo sem aviso.
    const sse = 'data: {"error":{"message":"rate limited","code":429}}\ndata: [DONE]';
    const r = extrairAudioSSE(sse);
    assert.equal(r.erro.code, 429);
    assert.deepEqual(r.pcmBase64, []);
  });

  test('JSON partido numa linha não derruba as linhas boas', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"data":"DDD="}}}',
      'data: {"choices":[{"delta":{"audio":{"data":"EEE="}}}]}',
      'data: [DONE]'
    ].join('\n');
    assert.deepEqual(extrairAudioSSE(sse).pcmBase64, ['EEE=']);
  });

  test('nada depois de [DONE] é lido', () => {
    const sse = [
      'data: {"choices":[{"delta":{"audio":{"data":"FFF="}}}]}',
      'data: [DONE]',
      'data: {"choices":[{"delta":{"audio":{"data":"GGG="}}}]}'
    ].join('\n');
    assert.deepEqual(extrairAudioSSE(sse).pcmBase64, ['FFF=']);
  });
});
