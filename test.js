import * as cheerio from 'cheerio';

async function main() {

  const html = await fetch("https://suno.com/song/1a95710f-17fa-41fc-9477-c63f4bafb1f7").then(res => res.text())
  const $ = cheerio.load(html)
  const titleRaw = $('title').text()
  const title = titleRaw.split(' by ')[0]
  const author = titleRaw.split(' by ')[1].replace(' | Suno', '')
  const image = $('meta[property="og:image"]').attr('content')

  console.log(title, author, image)
}


main()
