/**
 * 社区帖子（mock）。
 *
 * 首页参考闲鱼：顶部搜索 + 双列瀑布流帖子。
 * 真实实现时应接后端分页；这里只做形态验证。
 */

export interface Post {
  id: string
  author: string
  /** 作者头像用的纯色，避免引入图片资源 */
  avatarHex: string
  /** 帖子配图的纯色占位（同 reason：demo 阶段不引入二进制资源） */
  coverHex: string
  /** 封面宽高比，用于瀑布流错落 */
  ratio: number
  title: string
  tags: string[]
  likes: number
  comments: number
  /** 是否挂了单品链接（闲鱼式「可购买/可试穿」） */
  linkedProductId?: string
}

export const mockPosts: Post[] = [
  { id: 'po1', author: '林', avatarHex: '#c9b8a8', coverHex: '#e8e2da', ratio: 1.25,
    title: '通勤三件套，白衬衫配阔腿裤真的不会错', tags: ['通勤', '基础款'], likes: 128, comments: 23, linkedProductId: 'p_white_shirt' },
  { id: 'po2', author: '阿泽', avatarHex: '#8fa3b0', coverHex: '#d7dee3', ratio: 0.82,
    title: '牛仔外套叠穿，秋天最实用的一件', tags: ['叠穿', '秋'], likes: 342, comments: 56, linkedProductId: 'p_denim_jacket' },
  { id: 'po3', author: '小满', avatarHex: '#d3a9a0', coverHex: '#f0e4e0', ratio: 1.4,
    title: '围巾的四种系法，第三种最好看', tags: ['配饰', '教程'], likes: 891, comments: 140, linkedProductId: 'p_knit_scarf' },
  { id: 'po4', author: '陈', avatarHex: '#a8b39a', coverHex: '#e4e9dd', ratio: 1.0,
    title: '同一条阔腿裤，换上衣能穿出三种风格', tags: ['一衣多穿'], likes: 205, comments: 31, linkedProductId: 'p_wide_trousers' },
  { id: 'po5', author: 'Yuki', avatarHex: '#b7a9c9', coverHex: '#e8e2f0', ratio: 0.9,
    title: '小个子显高思路：提高腰线真的有用', tags: ['显高', '小个子'], likes: 664, comments: 98 },
  { id: 'po6', author: '老周', avatarHex: '#c9a98a', coverHex: '#eee4d8', ratio: 1.15,
    title: '衬衫不塞进裤子也好看的两个前提', tags: ['男装', '细节'], likes: 156, comments: 27 },
]

export function findPost(id: string): Post | undefined {
  return mockPosts.find((p) => p.id === id)
}
