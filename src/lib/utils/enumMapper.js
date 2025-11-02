const numeroEnum = {
  0: "CC"
};

const pdfMapper = (v) => {
  const dic = {
    'ColAdultos': 'ColAdultos/',
    'ColCIAs': 'ColCIAs/',
    'Adicionados': 'Adicionados/',
  };

  if(dic[v]) return dic[v];
  return 'Avulsos/';
};

const classificacaoEnum = {
  'ColAdultos': "Coletânea de Partituras Adultos",
  'ColCIAs': "Coletânea de Partituras CIAs",
  'A': "Avulso PES",
  'DpLICM': "Departamento de Louvor ICM",
  'EL042025': "Encontro de Louvor 04/25",
  'GLGV': "Grupo de Louvor Gov. Valadares",
  'GLMUberlandia': "Grupo de Louvor do Maanaim de Uberlândia",
  'ACIA': 'Avulso CIAs',
  'PESCol': 'Novo Arranjo PES',
};

export const enumMapper = (v) => {
  if(numeroEnum[v]) return numeroEnum[v];
  if(classificacaoEnum[v]) return classificacaoEnum[v];
  return v;
};

export { pdfMapper, classificacaoEnum, numeroEnum };

