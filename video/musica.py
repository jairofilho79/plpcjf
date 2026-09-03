#!/usr/bin/env python3
"""Leito musical dos vídeos tutoriais.

Prelúdio nº 1 em Dó maior, BWV 846, de J. S. Bach (1685-1750): a obra está em
domínio público e a gravação produzida aqui é nossa. Nenhum acervo de terceiros
está envolvido, que é exatamente onde mora o risco de direitos quando se "baixa
uma clássica de graça".
"""
import numpy as np
import wave
import os

TAXA = 44100
PASSO = 0.22          # duração de cada semicolcheia do arpejo
REPETICOES = 5        # 16 compassos dão ~56 s; cinco voltas cobrem o vídeo mais longo

# Os 16 primeiros compassos, cada um como as cinco alturas do arpejo (MIDI),
# do grave para o agudo. Dentro do compasso, Bach toca n1 n2 n3 n4 n5 n3 n4 n5
# e repete — é o PADRAO abaixo.
COMPASSOS = [
    [48, 52, 55, 60, 64], [48, 50, 57, 62, 65], [47, 50, 55, 62, 65],
    [48, 52, 55, 60, 64], [48, 52, 57, 64, 69], [48, 50, 54, 57, 62],
    [47, 50, 55, 62, 67], [47, 48, 52, 55, 60], [45, 48, 52, 55, 60],
    [50, 57, 62, 66, 72], [43, 47, 50, 55, 59], [43, 46, 52, 55, 61],
    [41, 45, 50, 57, 62], [41, 44, 50, 53, 59], [40, 43, 48, 55, 60],
    [40, 41, 45, 48, 53],
]
PADRAO = [0, 1, 2, 3, 4, 2, 3, 4]


def frequencia(midi):
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def nota(midi, dur, ganho=1.0):
    """Uma nota: parciais harmónicas com envelope de corda dedilhada.

    As parciais caem depressa e o ataque é curto — o objetivo é um leito que
    fique atrás da voz, não um piano de concerto à frente dela.
    """
    n = int(dur * TAXA)
    t = np.arange(n) / TAXA
    f = frequencia(midi)
    onda = np.zeros(n)
    for k, peso in enumerate([1.0, 0.42, 0.18, 0.09, 0.04], start=1):
        if f * k > TAXA / 2:          # nada acima de Nyquist: só produziria alias
            break
        onda += peso * np.sin(2.0 * np.pi * f * k * t)
    env = np.exp(-t * 2.4)
    ataque = max(1, int(0.006 * TAXA))
    env[:ataque] *= np.linspace(0.0, 1.0, ataque)
    return onda * env * ganho


def sintetizar():
    rng = np.random.default_rng(7)
    notas_por_volta = len(COMPASSOS) * 2 * len(PADRAO)
    total = int((notas_por_volta * REPETICOES * PASSO + 3.0) * TAXA)
    mix = np.zeros(total)
    pos = 0
    for volta in range(REPETICOES):
        for compasso in COMPASSOS:
            for _ in range(2):
                for idx in PADRAO:
                    # variação leve por nota: sem ela, cinco voltas idênticas
                    # soam a loop, e ouvido humano percebe loop mesmo a -22 dB.
                    ganho = 0.86 + 0.14 * rng.random()
                    n = nota(compasso[idx], 1.5, ganho)
                    fim = min(pos + len(n), total)
                    mix[pos:fim] += n[:fim - pos]
                    pos += int(PASSO * TAXA)
    pico_seco = np.max(np.abs(mix)) or 1.0

    # Reverberação curta por convolução com ruído decrescente.
    cauda = int(0.45 * TAXA)
    ir = rng.normal(0.0, 1.0, cauda) * np.exp(-np.arange(cauda) / (0.11 * TAXA))
    molhado = np.convolve(mix, ir, mode='same')
    molhado = molhado / (np.max(np.abs(molhado)) or 1.0) * pico_seco

    saida = 0.82 * mix + 0.18 * molhado
    saida = saida / (np.max(np.abs(saida)) or 1.0) * 0.70   # pico em ~-3 dBFS
    return np.stack([saida, saida], axis=1)


if __name__ == '__main__':
    os.makedirs('video/build', exist_ok=True)
    est = sintetizar()
    destino = 'video/build/leito-musical.wav'
    with wave.open(destino, 'w') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(TAXA)
        w.writeframes((est * 32767.0).astype('<i2').tobytes())
    print(f'{destino}: {est.shape[0] / TAXA:.1f} s')
