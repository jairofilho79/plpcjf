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

# Tudo em fracao da dimensao do quadro, e nao em pixels fixos.
#
# Numeros fixos so servem para um tamanho de quadro, e a dimensao real dos
# quadros e medida na gravacao - nao e uma constante que se possa escrever
# aqui. Foi supor essa constante que produziu um video inteiro com a legenda
# desenhada ao dobro do tamanho, com o rodape fora do quadro.
CORPO_FRACAO = 0.030      # do lado da largura do quadro
ENTRELINHA = 1.34
MARGEM_X_FRACAO = 0.021
MARGEM_Y_FRACAO = 0.0095
RAIO_FRACAO = 0.011

# Distancia do fundo ate a base da faixa, em fracao da altura.
#
# 11% e nao 5%: a barra de controlos do player cobre o rodape do video quando
# ele toca embutido numa pagina, e uma legenda escondida atras dela e uma
# legenda que nao existe.
FUNDO_FRACAO = 0.11


def carregar_fonte(largura):
    corpo = max(12, round(largura * CORPO_FRACAO))
    try:
        return ImageFont.truetype(FONTE, corpo), corpo
    except OSError:
        # Sem a fonte do sistema a legenda sairia minuscula e ilegivel; e
        # melhor falhar aqui do que entregar um video com legenda de 11 px.
        raise SystemExit(f'fonte nao encontrada: {FONTE}')


def desenhar(largura, altura, linhas, saida, fonte, corpo):
    img = Image.new('RGBA', (largura, altura), (0, 0, 0, 0))
    if not linhas:
        img.save(saida)
        return

    d = ImageDraw.Draw(img)
    alturaLinha = int(corpo * ENTRELINHA)
    margemX = round(largura * MARGEM_X_FRACAO)
    margemY = round(largura * MARGEM_Y_FRACAO)
    raio = max(4, round(largura * RAIO_FRACAO))
    sombra = max(1, round(corpo / 14))

    larguras = [d.textbbox((0, 0), l, font=fonte)[2] for l in linhas]

    caixaL = min(largura - margemX, max(larguras) + margemX * 2)
    caixaA = alturaLinha * len(linhas) + margemY * 2
    caixaX = (largura - caixaL) // 2
    caixaY = altura - round(altura * FUNDO_FRACAO) - caixaA

    d.rounded_rectangle(
        [caixaX, caixaY, caixaX + caixaL, caixaY + caixaA],
        radius=raio,
        fill=(0, 0, 0, 178)
    )

    y = caixaY + margemY
    for linha, larg in zip(linhas, larguras):
        x = (largura - larg) // 2
        # Sombra: a faixa e translucida, entao o texto ainda passa por cima de
        # tudo o que a app desenhar por baixo dela.
        d.text((x + sombra, y + sombra), linha, font=fonte, fill=(0, 0, 0, 210))
        d.text((x, y), linha, font=fonte, fill=(255, 255, 255, 255))
        y += alturaLinha

    os.makedirs(os.path.dirname(saida) or '.', exist_ok=True)
    img.save(saida)


def main():
    pedido = json.load(sys.stdin)
    largura = pedido['largura']
    altura = pedido['altura']
    fonte, corpo = carregar_fonte(largura)
    for t in pedido['trabalhos']:
        desenhar(largura, altura, t['linhas'], t['saida'], fonte, corpo)
    print(len(pedido['trabalhos']))


if __name__ == '__main__':
    main()
