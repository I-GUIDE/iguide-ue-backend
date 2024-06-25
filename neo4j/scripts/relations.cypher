MATCH (fang:Author {name: 'Fangzheng Lyu'}), (nb1:Notebook {id: 'nb1'}), (nb2:Notebook {id: 'nb2'}), (nb3:Notebook {id: 'nb3'}), (ds1:Dataset {id: 'ds1'}), (ds2:Dataset {id: 'ds2'}), (ds3:Dataset {id: 'ds3'}), (ds4:Dataset {id: 'ds4'})
CREATE (fang)-[:CREATED]->(nb1), (fang)-[:CREATED]->(nb2), (fang)-[:CREATED]->(nb3)
CREATE (fang)-[:PUBLISHED]->(ds1), (fang)-[:PUBLISHED]->(ds2), (fang)-[:PUBLISHED]->(ds3)

CREATE (nb2)-[:USES]->(ds1), (nb2)-[:USES]->(ds2), (nb2)-[:USES]->(ds3)
CREATE (nb3)-[:USES]->(ds1), (nb3)-[:USES]->(ds2), (nb3)-[:USES]->(ds4)
CREATE (nb4)-[:USES]->(ds1), (nb4)-[:USES]->(ds2), (nb4)-[:USES]->(ds4)

MATCH (jinwoo:Author {name: 'Jinwoo Park'}), (nb5:Notebook {id: 'nb5'}), (ds5:Dataset {id: 'ds5'}), (ds6:Dataset {id: 'ds6'}), (ds7:Dataset {id: 'ds7'})

CREATE (jinwoo)-[:CREATED]->(nb5)
CREATE (nb5)-[:USES]->(ds5), (nb5)-[:USES]->(ds6), (nb5)-[:USES]->(ds7)

MATCH (fbaig:Author {name: 'Furqan Baig'}),(ds1:Dataset {id: 'ds1'})
CREATE (fang)-[:PUBLISHED]->(ds1)