const {
  BaseKonnector,
  requestFactory,
  scrape,
  saveBills,
  log,
  utils
} = require('cozy-konnector-libs')
const request = requestFactory({
  cheerio: false,
  json: false,
  jar: true
})
const soap = require('soap')

const baseWSDL = 'https://www.silaexpert01.fr/Silae/SWS/SWS.asmx?WSDL'
const baseUrl = 'https://www.silaexpert01.fr'
const basePath = '/Silae/SWS/SWS.asmx'
let repartiteurAdresse, token, id_domaine, id_paisalarie

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  const client = await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a  Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(`${baseUrl}/index.html`, client)
  // cheerio (https://cheerio.js.org/) uses the same api as jQuery (http://jquery.com/)
  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  // Here we use the saveBills function even if what we fetch are not bills,
  // but this is the most common case in connectors
  log('info', 'Saving data to Cozy')
  await saveBills(documents, fields, {
    // This is a bank identifier which will be used to link bills to bank operations. These
    // identifiers should be at least a word found in the title of a bank operation related to this
    // bill. It is not case sensitive.
    identifiers: ['books']
  })
}

function authenticate(username, password) {
  return new Promise((resolve, reject) =>
    soap.createClient(baseWSDL, function (err, client) {
      log('info', 'Client successfully created')
      client.SWS_SiteLoginEx({
        SWSLogin: '',
        SWSPassword: '',
        USRLogin: username,
        USRPassword: password
      },
        function (err, result) {
          resolve(result)
        }
      )
    })
  ).then(result => {
    const adresseFermeDistante =
      result.SWS_SiteLoginExResult.AdresseFermeDistante
    log(
      'info',
      'Using AdresseFermeDistante ' +
      adresseFermeDistante
    )
    return new Promise((resolve, reject) =>
      soap.createClient(baseWSDL, function (err, client) {
        client.setEndpoint('https://' + adresseFermeDistante + basePath)
        client.SWS_SiteLoginEx({
          SWSLogin: '',
          SWSPassword: '',
          USRLogin: username,
          USRPassword: password
        },
          function (err, result) {
            resolve(result)
          }
        )
      })
    )
  }).then(result => {
      repartiteurAdresse = result.SWS_SiteLoginExResult.RepartiteurAdresse
    log(
      'info',
      'Using RepartiteurAdresse ' +
      repartiteurAdresse
    )
    return new Promise((resolve, reject) =>
      soap.createClient(baseWSDL, function (err, client) {
        client.setEndpoint('https://' + repartiteurAdresse + basePath)
        client.SWS_SiteLoginEx({
          SWSLogin: '',
          SWSPassword: '',
          USRLogin: username,
          USRPassword: password
        },
          function (err, result) {
            resolve(result)
          }
        )
      })
    )
  }).then(result => {
    console.log(result.SWS_SiteLoginExResult)
    console.log(result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet)
    token = result.SWS_SiteLoginExResult.Token
    id_domaine = result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0].ID_DOMAINE
    id_paisalarie = result.SWS_SiteLoginExResult.ListeOnglets.SWS_InformationsOnglet[0].ID_PAISALARIE
    console.log(token, id_domaine, id_paisalarie)
  })
}

// The goal of this function is to parse a HTML page wrapped by a cheerio instance
// and return an array of JS objects which will be saved to the cozy by saveBills
// (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // You can find documentation about the scrape function here:
  // https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#scrape
  const docs = scrape(
    $, {
      title: {
        sel: 'h3 a',
        attr: 'title'
      },
      amount: {
        sel: '.price_color',
        parse: normalizePrice
      },
      fileurl: {
        sel: 'img',
        attr: 'src',
        parse: src => `${baseUrl}/${src}`
      }
    },
    'article'
  )
  return docs.map(doc => ({
    ...doc,
    // The saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    date: !new Date(),
    currency: 'EUR',
    filename: `${utils.formatDate(new Date())}_${VENDOR}_${doc.amount.toFixed(
      2
    )}EUR${doc.vendorRef ? '_' + doc.vendorRef : ''}.jpg`,
    vendor: VENDOR,
    metadata: {
      // It can be interesting to add the date of import. This is not mandatory but may be
      // useful for debugging or data migration
      importDate: new Date(),
      // Document version, useful for migration after change of document structure
      version: 1
    }
  }))
}

// Convert a price string to a float
function normalizePrice(price) {
  return parseFloat(price.replace('£', '').trim())
}
