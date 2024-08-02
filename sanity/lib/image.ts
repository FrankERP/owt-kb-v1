import createImageUrlBuilder from '@sanity/image-url'
import { SanityImageSource } from "@sanity/image-url/lib/types/types";

import { dataset, projectId } from '../env'
import { Image } from 'sanity';

// https://www.sanity.io/docs/image-url
const builder = createImageUrlBuilder({ projectId, dataset })
const imageBuilder = createImageUrlBuilder({
  projectId: projectId || '',
  dataset: dataset || '',
})

export const urlFor = (source: SanityImageSource) => {
  return builder.image(source)
}

export const urlForImage = (source: Image) => {
  return imageBuilder?.image(source).auto('format').fit('max')
}