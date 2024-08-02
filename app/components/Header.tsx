import Link from 'next/link';
import React from 'react'

interface Props {
  title: string;
  tags?: boolean;
}

const Header = ({title = "", tags = false}:Props) => {
  return (
    <header className='py-14 px-4 mb-12 text-center border-b dark:border-[#00bfff] border-[#002249] mx-auto max-w-2xl font-bold'>
      <h2 className='uppercase text-2xl ' >{title}</h2>
      {tags && (
        <div className="text-s mt-2 hover:text-[#00bfff]">
          <Link href= "/tag">#tags</Link>
        </div>
      )}
    </header>
  )
}

export default Header