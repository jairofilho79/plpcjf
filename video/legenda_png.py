#!/usr/bin/env python3
"""Rasteriza legendas em PNG transparente.

Este ffmpeg (Homebrew 8.1) foi compilado sem `libass` e sem `libfreetype`, o
que tira do jogo tanto `subtitles=` como `drawtext=`. A saida e sobrepor uma
imagem por legenda, e e isso que este script produz.

Recebe por stdin um JSON `{"largura": int, "altura": int, "trabalhos": [
{"saida": str, "linhas": [str]} ]}` e escreve todos os PNGs. Um processo por
video, e nao por legenda: arrancar o Python vinte vezes custa mais que desenhar.
"""
import json
import sys
import os
from PIL import Image, ImageDraw, ImageFont

FONTE = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
CORPO = 46               # no mestre de 1640 px de largura
ENTRELINHA = 1.34
MARGEM_X = 34            # respiro interno da faixa
MARGEM_Y = 22
FUNDO_BASE = 130         # distancia do fundo do quadro ate a base da faixa
RAIO = 18


def carregar_fonte():
    try:
        return ImageFont.truetype(FONTE, CORPO)
    except OSError:
        # Sem a fonte do sistema a legenda sairia minuscula e ilegivel; e
        # melhor falhar aqui do que entregar um video com legenda de 11 px.
        raise SystemExit(f'fonte nao encontrada: {FONTE}')


def desenhar(largura, altura, linhas, saida, fonte):
    img = Image.new('RGBA', (largura, altura), (0, 0, 0, 0))
    if not linhas:
        img.save(saida)
        return

    d = ImageDraw.Draw(img)
    alturaLinha = int(CORPO * ENTRELINHA)
    larguras = [d.textbbox((0, 0), l, font=fonte)[2] for l in linhas]

    caixaL = max(larguras) + MARGEM_X * 2
    caixaA = alturaLinha * len(linhas) + MARGEM_Y * 2
    caixaX = (largura - caixaL) // 2
    caixaY = altura - FUNDO_BASE - caixaA

    d.rounded_rectangle(
        [caixaX, caixaY, caixaX + caixaL, caixaY + caixaA],
        radius=RAIO,
        fill=(0, 0, 0, 158)
    )

    y = caixaY + MARGEM_Y
    for linha, larg in zip(linhas, larguras):
        x = (largura - larg) // 2
        # Sombra: a faixa e translucida, entao o texto ainda passa por cima de
        # tudo o que a app desenhar por baixo dela.
        d.text((x + 2, y + 2), linha, font=fonte, fill=(0, 0, 0, 200))
        d.text((x, y), linha, font=fonte, fill=(255, 255, 255, 255))
        y += alturaLinha

    os.makedirs(os.path.dirname(saida) or '.', exist_ok=True)
    img.save(saida)


def main():
    pedido = json.load(sys.stdin)
    fonte = carregar_fonte()
    largura = pedido['largura']
    altura = pedido['altura']
    for t in pedido['trabalhos']:
        desenhar(largura, altura, t['linhas'], t['saida'], fonte)
    print(len(pedido['trabalhos']))


if __name__ == '__main__':
    main()
