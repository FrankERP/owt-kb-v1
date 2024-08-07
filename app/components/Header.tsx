import Link from 'next/link';
import React from 'react'

interface Props {
  title: string;
  tags?: boolean;
  author?: string;
}

const Header = ({title = "", tags = false, author=""}:Props) => {
  return (
    <header className='pb-14 px-4 mb-12 text-center border-b dark:border-[#00bfff] border-[#002249] mx-auto min-w-[50vw] max-w-2xl font-bold'>
      <h1 className='uppercase text-5xl ' >{title}</h1>
      {author &&(
        <h2 className='uppercase text-xl ' >{author}</h2>
      )}
      {tags && (
        <div className="text-md mt-2 hover:text-[#00bfff]">
          <Link href= "/tag">#tags</Link>
        </div>
      )}
    </header>
  )
}

export default Header